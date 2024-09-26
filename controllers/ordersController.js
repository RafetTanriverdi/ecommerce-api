const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const ORDERS_TABLE = process.env.ORDERS_TABLE;

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
  const ownerId = req.user.sub;
  try {
    const params = {
      TableName: ORDERS_TABLE,
      FilterExpression: "ownerId = :ownerId",
      ExpressionAttributeValues: {
        ":ownerId": ownerId,
      },
    };

    const data = await docClient.send(new ScanCommand(params));
    res.status(200).json(data.Items);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ error: "Could not fetch orders" });
  }
};

exports.GetOrder = async (req, res) => {
  const { orderId } = req.params;
  const ownerId = req.user.sub;

  try {
    const params = {
      TableName: ORDERS_TABLE,
      Key: {
        orderId: orderId,
      },
    };

    const data = await docClient.send(new GetCommand(params));

    if (!data.Item) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (data.Item.ownerId !== ownerId) {
      return res
        .status(403)
        .json({ error: "You do not have access to this order" });
    }

    res.status(200).json(data.Item);
  } catch (err) {
    console.error("Error fetching order:", err);
    res.status(500).json({ error: "Could not fetch order" });
  }
};
