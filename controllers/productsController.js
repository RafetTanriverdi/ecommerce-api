const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;

exports.ListProducts = async (req, res) => {
  try {
    const params = {
      TableName: PRODUCTS_TABLE,
      ProjectionExpression:
        "productId, productName, price, description, stock, imageUrl,stripePriceId,createdAt",
    };

    const data = await docClient.send(new ScanCommand(params));
    res.status(200).json(data.Items);
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ error: "Could not fetch products" });
  }
};

exports.GetProduct = async (req, res) => {
  const { productId } = req.params;
  try {
    const params = {
      TableName: PRODUCTS_TABLE,
      Key: {
        productId: productId,
      },
      ProjectionExpression:
        "productId, productName, price, description, stock, imageUrl,stripePriceId,createdAt",
    };

    const { Item } = await docClient.send(new GetCommand(params));

    res.status(200).json(Item);
  } catch (err) {
    res.status(500).json({ error: "Could not fetch product" });
  }
};
