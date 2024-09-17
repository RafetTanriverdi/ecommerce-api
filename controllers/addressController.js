const { v4: uuidv4 } = require("uuid");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);

const CUSTOMERS_TABLE = process.env.CUSTOMER_TABLE;

exports.DeleteAddress = async (req, res) => {
  const customerId = req.user.sub;
  const { addressId } = req.params;

  try {
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

    const params = {
      TableName: CUSTOMERS_TABLE,
      Key: { customerId: customerId },
      UpdateExpression: "SET addresses = :filteredAddresses",
      ExpressionAttributeValues: {
        ":filteredAddresses": filteredAddresses,
      },
      ReturnValues: "UPDATED_NEW",
    };

    const { Attributes } = await docClient.send(new UpdateCommand(params));
    res.status(200).json(Attributes);
  } catch (err) {
    console.error("Error deleting address:", err);
    res.status(500).json({ message: "Could not delete address" });
  }
};

exports.UpdateAddress = async (req, res) => {
  const customerId = req.user.sub;
  const { address } = req.body;
  const { addressId } = req.params;

  try {
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

    const params = {
      TableName: CUSTOMERS_TABLE,
      Key: { customerId: customerId },
      UpdateExpression: "SET addresses = :updatedAddresses",
      ExpressionAttributeValues: {
        ":updatedAddresses": updatedAddresses,
      },
      ReturnValues: "UPDATED_NEW",
    };

    const { Attributes } = await docClient.send(new UpdateCommand(params));
    res.status(200).json(Attributes);
  } catch (err) {
    console.error("Error updating address:", err);
    res.status(500).json({ message: "Could not update address" });
  }
};

exports.ListAddresses = async (req, res) => {
  const customerId = req.user.sub;

  try {
    const existingAddresses = (
      await docClient.send(
        new GetCommand({
          TableName: CUSTOMERS_TABLE,
          Key: { customerId: customerId },
        })
      )
    ).Item.addresses;

    res.status(200).json({ addresses: existingAddresses });
  } catch (err) {
    console.error("Error listing addresses:", err);
    res.status(500).json({ message: "Could not retrieve addresses" });
  }
};

exports.AddAddress = async (req, res) => {
  const customerId = req.user.sub;
  const { address } = req.body;

  const newAddress = { ...address, addressId: uuidv4() };

  const params = {
    TableName: CUSTOMERS_TABLE,
    Key: { customerId: customerId },
    UpdateExpression:
      "SET addresses = list_append(if_not_exists(addresses, :emptyList), :newAddress)",
    ExpressionAttributeValues: {
      ":newAddress": [newAddress],
      ":emptyList": [],
    },
    ReturnValues: "UPDATED_NEW",
  };

  try {
    const { Attributes } = await docClient.send(new UpdateCommand(params));
    res.status(200).json(Attributes);
  } catch (err) {
    console.error("Error adding address:", err);
    res.status(500).json({ message: "Could not add address" });
  }
};

exports.GetAddresses = async (req, res) => {
  const customerId = req.user.sub;

  const { addressId } = req.params;

  try {
    const existingAddresses = (
      await docClient.send(
        new GetCommand({
          TableName: CUSTOMERS_TABLE,
          Key: { customerId: customerId },
        })
      )
    ).Item.addresses;

    const address = existingAddresses.find(
      (addr) => addr.addressId === addressId
    );

    res.status(200).json(address);
  } catch (err) {
    console.error("Error getting address:", err);
    res.status(500).json({ message: "Could not retrieve address" });
  }
};
