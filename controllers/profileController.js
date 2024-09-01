const { GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const { CognitoIdentityServiceProvider } = require("aws-sdk");
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
        res.status(500).json({ message: "Could not fetch profile" });
    }
};
exports.UpdateProfile = async (req, res) => {
    const customerId = req.user.sub;
    const { name, email, address, phone } = req.body;
  
    // DynamoDB güncelleme parametreleri
    const params = {
      TableName: CUSTOMERS_TABLE,
      Key: { customerId: customerId },
      UpdateExpression:
        "SET #name = :name, email = :email, addresses = list_append(if_not_exists(addresses, :emptyList), :newAddress), phone = :phone, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#name": "name",
      },
      ExpressionAttributeValues: {
        ":name": name,
        ":email": email,
        ":phone": phone,
        ":newAddress": [address], // Adresi array olarak ekliyoruz
        ":emptyList": [], // Eğer adres listesi yoksa boş array oluştur
        ":updatedAt": new Date().toISOString(),
      },
      ReturnValues: "UPDATED_NEW",
    };
  
    try {
      // DynamoDB'de güncelleme
      const { Attributes } = await docClient.send(new UpdateCommand(params));
  
      // Stripe'ta müşteri bilgilerini güncelleme
      await stripe.customers.update(customerId, {
        name: name,
        phone: phone,
      });
  
      // Cognito'da kullanıcı bilgilerini güncelleme
      const cognitoParams = {
        UserAttributes: [
          { Name: "name", Value: name },
          { Name: "phone_number", Value: phone },
        ],
        UserPoolId: process.env.USER_POOL_ID, // Cognito User Pool ID
        Username: customerId, // Cognito Username olarak customerId'yi kullanıyoruz
      };
      await cognito.adminUpdateUserAttributes(cognitoParams).promise();
  
      // Başarılı yanıt döndürme
      res.status(200).json(Attributes);
    } catch (err) {
      console.error("Error updating profile:", err);
      res.status(500).json({ message: "Could not update profile" });
    }
  };