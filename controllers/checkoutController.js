const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const CUSTOMERS_TABLE = process.env.CUSTOMER_TABLE;
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
const ORDERS_TABLE = process.env.ORDERS_TABLE;

exports.PostCheckOutStripe = async (req, res) => {
  console.log("res", res);
  console.log("req", req);

  const { priceId, quantity, return_url } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      return_url: return_url,
      line_items: [
        {
          price: priceId,
          quantity: quantity,
        },
      ],
      mode: "payment",
    });
    console.log("session", session);
    res.status(200).json({ session: session });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.PostWebhook = async (req, res) => {
  let event = req.body;

  let orderData = {};
  switch (event.type) {
    case "checkout.session.completed":
      const session = event.data.object;

      const lineItems = await stripe.checkout.sessions.listLineItems(
        session.id,
        {
          limit: 10, // Satın alınan tüm ürünleri görmek için limiti artırabilirsiniz
        }
      );

      const priceId = lineItems.data[0].price.id;

      console.log("Satılan ürünün Price ID:", priceId);
      let productData;
      const productParams = {
        TableName: PRODUCTS_TABLE,
        FilterExpression: "stripePriceId = :stripePriceId",
        ExpressionAttributeValues: {
          ":stripePriceId": priceId,
        },
      };
      try {
        const productResponse = await docClient.send(
          new ScanCommand(productParams)
        );
        console.log("customerResponse", productResponse);
        if (productResponse.Items.length === 0) {
          console.error("Product not found.");
          return res.status(404).json({ error: "Product not found" });
        }
        productData = productResponse.Items[0];
      } catch (err) {
        console.error("Error fetching Product:", err);
        return res.status(500).json({ error: "Could not fetch Product" });
      }

      let customerData;
      const customerParams = {
        TableName: CUSTOMERS_TABLE,
        FilterExpression: "email = :email",
        ExpressionAttributeValues: {
          ":email": session.customer_details.email,
        },
      };
      try {
        const customerResponse = await docClient.send(
          new ScanCommand(customerParams)
        );
        console.log("customerResponse", customerResponse);
        if (customerResponse.Items.length === 0) {
          console.error("Customer not found.");
          return res.status(404).json({ error: "Customer not found" });
        }
        customerData = customerResponse.Items[0];
      } catch (err) {
        console.error("Error fetching customer:", err);
        return res.status(500).json({ error: "Could not fetch customer" });
      }

      orderData = {
        orderId: session.id,
        customerId: customerData.customerId,
        customerName: customerData.name,
        customerEmail: session.customer_details.email,
        currency: session.currency,
        paymentStatus: session.payment_status,
        amountTotal: session.amount_total,
        ownerId: customerData.customerId,
        createdAt: new Date().toISOString(),
        productId: productData.productId,
        productName: productData.productName,
        productPrice: productData.price,
        quantity: lineItems.data[0].quantity,
        priceId: lineItems.data[0].price.id,
      };

      const orderParams = {
        TableName: ORDERS_TABLE,
        Item: orderData,
      };

      try {
        await docClient.send(new PutCommand(orderParams));
        console.log("Order saved successfully:", orderData);
      } catch (err) {
        console.error("Error saving order:", err);
        return {
          statusCode: 500,
          body: "Error saving order",
        };
      }
      break;

    default:
      console.log(`Unhandled event type ${event.type}.`);
  }

  res.status(200).json({ received: true });
};
