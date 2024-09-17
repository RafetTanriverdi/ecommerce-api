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

    if (Item.profilePicture) {
      const profilePictureUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: Item.profilePicture,
        }),
        { expiresIn: 86400 }
      );
      Item.profilePictureUrl = profilePictureUrl;
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

  if (profilePicture) {
    if (profilePicture.startsWith("data:image/")) {
      const buffer = Buffer.from(
        profilePicture.replace(/^data:image\/\w+;base64,/, ""),
        "base64"
      );

      const fileExtension = "jpeg";
      const key = `profile-pictures/${customerId}.${fileExtension}`;

      const s3Params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentEncoding: "base64",
        ContentType: `image/${fileExtension}`,
        ACL: "private",
      };

      try {
        await s3Client.send(new PutObjectCommand(s3Params));
        profilePictureKey = key;
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
    expressionAttributeValues[":profilePicture"] = profilePictureKey;
  }

  if (cropData) {
    expressionAttributeValues[":cropData"] = cropData;
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

