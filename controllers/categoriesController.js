const { ScanCommand, DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");

const CATEGORIES_TABLE = process.env.CATEGORIES_TABLE;
const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);

exports.ListCategories = async (req, res) => {
    try {
        const params = {
        TableName: CATEGORIES_TABLE,
        };
    
        const data = await docClient.send(new ScanCommand(params));
        res.status(200).json(data.Items);
    } catch (err) {
        console.error("Error fetching categories:", err);
        res.status(500).json({ error: "Could not fetch categories" });
    }
    }
