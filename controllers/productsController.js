
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;

exports.ListProducts = async (req, res) => {
    try {
        const params = {
            TableName: PRODUCTS_TABLE,
            ProjectionExpression: "productId, productName, price, description, stock, imageUrl,stripePriceId,createdAt", 
        };

        const data = await docClient.send(new ScanCommand(params));
        res.status(200).json(data.Items);
    } catch (err) {
        console.error("Error fetching products:", err);
        res.status(500).json({ error: "Could not fetch products" });
    }
};

exports.GetProduct = async (req, res) => {
    const productId = req.params.productId;
    try {
        const params = {
            TableName: PRODUCTS_TABLE,
            Key: {
                productId: productId,
            },
        };

        const data = await docClient.get(params);
        res.status(200).json(data.Item);
    } catch (err) {
        console.error("Error fetching product:", err);
        res.status(500).json({ error: "Could not fetch product" });
    }
}
