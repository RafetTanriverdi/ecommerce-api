const { GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const { CognitoIdentityServiceProvider } = require("aws-sdk");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const s3Client = new S3Client();
const { v4: uuidv4 } = require('uuid');
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

      res.status(200).json(Item);
  } catch (err) {
      console.error("Error fetching profile:", err);
      res.status(500).json({ message: "Could not fetch profile" });
  }
};

exports.UpdateProfile = async (req, res) => {
  const customerId = req.user.sub;
  console.log(req);
  const { name, email, phone, address, stripeCustomerId, profilePicture } = req.body;

  let profilePictureUrl;

  if (profilePicture) {
      const buffer = Buffer.from(profilePicture.replace(/^data:image\/\w+;base64,/, ""), 'base64');
      const fileExtension = profilePicture.split(';')[0].split('/')[1];
      const key = `profile-pictures/${customerId}.${fileExtension}`;

      const s3Params = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentEncoding: 'base64',
          ContentType: `image/${fileExtension}`,
          ACL: 'private', // Varsayılan olarak özel tut
      };

      try {
          await s3Client.send(new PutObjectCommand(s3Params));
          profilePictureUrl = `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${key}`;
      } catch (err) {
          console.error("Error uploading profile picture:", err);
          return res.status(500).json({ message: "Could not upload profile picture" });
      }
  }

  const updateExpression = `
      SET #name = :name, 
          email = :email, 
          phone = :phone, 
          updatedAt = :updatedAt
          ${profilePictureUrl ? ', profilePicture = :profilePicture' : ''}
  `;
  
  const expressionAttributeValues = {
      ":name": name,
      ":email": email,
      ":phone": phone,
      ":updatedAt": new Date().toISOString(),
  };

  if (profilePictureUrl) {
      expressionAttributeValues[":profilePicture"] = profilePictureUrl;
  }

  const params = {
      TableName: CUSTOMERS_TABLE,
      Key: { customerId: customerId },
      UpdateExpression: updateExpression.trim(),
      ExpressionAttributeNames: {
          "#name": "name",
      },
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



  exports.UpdateAddress= async (req, res) => {
    const customerId = req.user.sub;
    const { action, address, addressId } = req.body;
  
    let updateExpression = '';
    let expressionAttributeValues = {};
    let expressionAttributeNames = {};
  
    if (action === 'add') {
      const newAddress = { ...address, addressId: uuidv4() };
      updateExpression = "SET addresses = list_append(if_not_exists(addresses, :emptyList), :newAddress)";
      expressionAttributeValues = {
        ":newAddress": [newAddress],
        ":emptyList": [],
      };
    } else if (action === 'update') {
      updateExpression = "SET addresses = :updatedAddresses";
      const existingAddresses = (await docClient.send(new GetCommand({
        TableName: CUSTOMERS_TABLE,
        Key: { customerId: customerId },
      }))).Item.addresses;
  
      const updatedAddresses = existingAddresses.map((addr) =>
        addr.addressId === addressId ? { ...addr, ...address } : addr
      );
  
      expressionAttributeValues = { ":updatedAddresses": updatedAddresses };
    } else if (action === 'delete') {
      updateExpression = "SET addresses = :filteredAddresses";
      const existingAddresses = (await docClient.send(new GetCommand({
        TableName: CUSTOMERS_TABLE,
        Key: { customerId: customerId },
      }))).Item.addresses;
  
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
      console.error("Error updating profile:", err);
      res.status(500).json({ message: "Could not update profile" });
    }
  };