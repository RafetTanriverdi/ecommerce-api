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

    // If a profile picture exists, generate a signed URL
    if (Item.profilePicture) {
      const profilePictureUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: Item.profilePicture, // The S3 key saved in the user's profile
        }),
        { expiresIn: 3600 } // URL will expire after 1 hour
      );
      Item.profilePictureUrl = profilePictureUrl; // Attach the signed URL to the response
    }

    res.status(200).json(Item);
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ message: "Could not fetch profile" });
  }
};


exports.UpdateProfile = async (req, res) => {
  const customerId = req.user.sub;
  const { name, email, phone, address, stripeCustomerId, profilePicture } = req.body;

  let profilePictureKey;

  // Upload the cropped image to S3
  if (profilePicture) {
    const buffer = Buffer.from(
      profilePicture.replace(/^data:image\/\w+;base64,/, ""), // Strip the base64 prefix
      "base64"
    );
    const fileExtension = "jpeg"; // Assuming it's always JPEG; change if needed.
    const key = `profile-pictures/${customerId}.${fileExtension}`; // Generate S3 key based on customerId.

    const s3Params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentEncoding: "base64",
      ContentType: `image/${fileExtension}`,
      ACL: "private", // Keep the image private
    };

    try {
      // Upload the image to S3
      await s3Client.send(new PutObjectCommand(s3Params));
      profilePictureKey = key; // Save the key to store in DynamoDB
    } catch (err) {
      console.error("Error uploading cropped profile picture:", err);
      return res.status(500).json({ message: "Could not upload profile picture" });
    }
  }

  // Update the user's profile in DynamoDB
  const updateExpression = `
    SET #name = :name, 
        email = :email, 
        phone = :phone, 
        updatedAt = :updatedAt
        ${profilePictureKey ? ", profilePicture = :profilePicture" : ""}
  `;

  const expressionAttributeValues = {
    ":name": name,
    ":email": email,
    ":phone": phone,
    ":updatedAt": new Date().toISOString(),
  };

  if (profilePictureKey) {
    expressionAttributeValues[":profilePicture"] = profilePictureKey; // Store the S3 key for the profile picture.
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
    // Update the user's record in DynamoDB
    const { Attributes } = await docClient.send(new UpdateCommand(params));

    // Update the user in Stripe
    await stripe.customers.update(stripeCustomerId, {
      name: name,
      phone: phone,
    });

    // Update the user's attributes in Cognito
    const cognitoParams = {
      UserAttributes: [
        { Name: "name", Value: name },
        { Name: "phone_number", Value: phone },
      ],
      UserPoolId: process.env.USER_POOL_ID,
      Username: customerId,
    };
    await cognito.adminUpdateUserAttributes(cognitoParams).promise();

    res.status(200).json(Attributes); // Return the updated profile
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
