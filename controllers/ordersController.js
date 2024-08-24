const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const ORDERS_TABLE = process.env.ORDERS_TABLE;

// Sipariş ekleme işlemi
exports.AddOrder = async (session) => {
  const orderData = {
    orderId: session.id,
    customerEmail: session.email,
    amountTotal: session.amount_total,
    currency: session.currency,
    paymentStatus: session.payment_status,
    createdAt: new Date().toISOString(),
  };

  const params = {
    TableName: ORDERS_TABLE,
    Item: orderData,
  };

  try {
    await docClient.send(new PutCommand(params));
    console.log("Order saved successfully:", orderData);
  } catch (err) {
    console.error("Error saving order:", err);
  }
};

exports.ListOrders = async (req, res) => {
  try {
    const params = {
      TableName: ORDERS_TABLE,
    };

    const data = await docClient.send(new ScanCommand(params));
    res.status(200).json(data.Items);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ error: "Could not fetch orders" });
  }
};
