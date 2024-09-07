const { GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const { CognitoIdentityServiceProvider } = require("aws-sdk");
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const s3Client = new S3Client();
const { v4: uuidv4 } = require("uuid");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const CUSTOMERS_TABLE = process.env.CUSTOMER_TABLE;

const cognito = new CognitoIdentityServiceProvider();

exports.GetProfile = async (req, res) => {
  const customerId = req.user.sub;
  const params = {
    TableName: CUSTOMERS_TABLE,
    Key: {
      customerId: customerId,
    },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(params));
    if (!Item) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // Eğer profil resmi varsa, imzalı URL oluşturuyoruz
    if (Item.profilePicture) {
      const profilePictureUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: Item.profilePicture,
        }),
        { expiresIn: 86400 } // 1 saat sonra süresi dolacak
      );
      Item.profilePictureUrl = profilePictureUrl; // Signed URL ekleniyor
    }

    res.status(200).json(Item);
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ message: "Could not fetch profile" });
  }
};


exports.UpdateProfile = async (req, res) => {
  const customerId = req.user.sub;
  const { name, email, phone, stripeCustomerId, profilePicture, cropData } =
    req.body;

  let profilePictureKey;

  // Eğer profil resmi varsa, resmi S3'e yükle
  if (profilePicture) {
    if (profilePicture.startsWith("data:image/")) {
      const buffer = Buffer.from(
        profilePicture.replace(/^data:image\/\w+;base64,/, ""), // base64 başlığını kaldırıyoruz
        "base64"
      );

      const fileExtension = "jpeg"; // JPEG olduğunu varsayıyoruz
      const key = `profile-pictures/${customerId}.${fileExtension}`; // S3 anahtarı oluşturuyoruz

      const s3Params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentEncoding: "base64",
        ContentType: `image/${fileExtension}`,
        ACL: "private", // Görseli özel tutuyoruz
      };

      try {
        await s3Client.send(new PutObjectCommand(s3Params)); // Resmi S3'e yüklüyoruz
        profilePictureKey = key; // S3 anahtarını kaydediyoruz
      } catch (err) {
        console.error("Error uploading profile picture:", err);
        return res
          .status(500)
          .json({ message: "Could not upload profile picture" });
      }
    } else {
      return res
        .status(400)
        .json({ message: "Invalid profile picture format, must be base64" });
    }
  }

  // Kullanıcı profilini DynamoDB'de güncelle
  const updateExpression = `
    SET #name = :name, 
        email = :email, 
        phone = :phone, 
        updatedAt = :updatedAt
        ${profilePictureKey ? ", profilePicture = :profilePicture" : ""}
        ${cropData ? ", cropData = :cropData" : ""}
  `;

  const expressionAttributeValues = {
    ":name": name,
    ":email": email,
    ":phone": phone,
    ":updatedAt": new Date().toISOString(),
  };

  if (profilePictureKey) {
    expressionAttributeValues[":profilePicture"] = profilePictureKey; // Profil resmi S3 anahtarı
  }

  if (cropData) {
    expressionAttributeValues[":cropData"] = cropData; // Croplama bilgileri
  }

  const params = {
    TableName: CUSTOMERS_TABLE,
    Key: { customerId: customerId },
    UpdateExpression: updateExpression.trim(),
    ExpressionAttributeNames: { "#name": "name" },
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: "UPDATED_NEW",
  };

  try {
    const { Attributes } = await docClient.send(new UpdateCommand(params));

    await stripe.customers.update(stripeCustomerId, {
      name: name,
      phone: phone,
    });

    const cognitoParams = {
      UserAttributes: [
        { Name: "name", Value: name },
        { Name: "phone_number", Value: phone },
      ],
      UserPoolId: process.env.USER_POOL_ID,
      Username: customerId,
    };
    await cognito.adminUpdateUserAttributes(cognitoParams).promise();

    res.status(200).json(Attributes);
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).json({ message: "Could not update profile" });
  }
};

exports.UpdateAddress = async (req, res) => {
  const customerId = req.user.sub;
  const { action, address, addressId } = req.body;

  let updateExpression = "";
  let expressionAttributeValues = {};

  if (action === "add") {
    const newAddress = { ...address, addressId: uuidv4() };
    updateExpression =
      "SET addresses = list_append(if_not_exists(addresses, :emptyList), :newAddress)";
    expressionAttributeValues = {
      ":newAddress": [newAddress],
      ":emptyList": [],
    };
  } else if (action === "update") {
    updateExpression = "SET addresses = :updatedAddresses";
    const existingAddresses = (
      await docClient.send(
        new GetCommand({
          TableName: CUSTOMERS_TABLE,
          Key: { customerId: customerId },
        })
      )
    ).Item.addresses;

    const updatedAddresses = existingAddresses.map((addr) =>
      addr.addressId === addressId ? { ...addr, ...address } : addr
    );

    expressionAttributeValues = { ":updatedAddresses": updatedAddresses };
  } else if (action === "delete") {
    updateExpression = "SET addresses = :filteredAddresses";
    const existingAddresses = (
      await docClient.send(
        new GetCommand({
          TableName: CUSTOMERS_TABLE,
          Key: { customerId: customerId },
        })
      )
    ).Item.addresses;

    const filteredAddresses = existingAddresses.filter(
      (addr) => addr.addressId !== addressId
    );

    expressionAttributeValues = { ":filteredAddresses": filteredAddresses };
  }

  const params = {
    TableName: CUSTOMERS_TABLE,
    Key: { customerId: customerId },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: "UPDATED_NEW",
  };

  try {
    const { Attributes } = await docClient.send(new UpdateCommand(params));
    res.status(200).json(Attributes);
  } catch (err) {
    console.error("Error updating address:", err);
    res.status(500).json({ message: "Could not update address" });
  }
};
