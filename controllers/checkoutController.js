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
  const { orderedItems, shippingAddress, customer, customerEmail, promoCode, amount } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: "usd",
      customer: customer,
      
      metadata: {
        orderItems: JSON.stringify(orderedItems),
      },
      receipt_email: customerEmail,
    });

    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Error creating PaymentIntent", error);
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

function removeUndefinedValues(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedValues).filter((item) => item !== undefined);
  } else if (typeof obj === 'object' && obj !== null) {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = removeUndefinedValues(value);
      }
      return acc;
    }, {});
  }
  return obj;
}

exports.PostWebhook = async (req, res) => {
  let event;

  try {
    event = req.body;
  } catch (err) {
    console.error("Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "payment_intent.succeeded":
      const paymentIntent = event.data.object;

      // Retrieve the customer details based on the customer ID or email
      let customerData;
      const customerParams = {
        TableName: CUSTOMERS_TABLE,
        FilterExpression: "email = :email",
        ExpressionAttributeValues: {
          ":email": paymentIntent.receipt_email,
        },
      };

      try {
        const customerResponse = await docClient.send(new ScanCommand(customerParams));
        console.log("Customer response:", customerResponse);
        if (customerResponse.Items.length === 0) {
          console.error("Customer not found.");
          return res.status(404).json({ error: "Customer not found" });
        }
        customerData = customerResponse.Items[0];
      } catch (err) {
        console.error("Error fetching customer:", err);
        return res.status(500).json({ error: "Could not fetch customer" });
      }

      let lineItems;
      try {
        lineItems = paymentIntent.metadata.orderItems 
          ? JSON.parse(paymentIntent.metadata.orderItems) 
          : [];
        console.log("Line items:", lineItems);
      } catch (err) {
        console.error("Error parsing line items:", err.message);
        return res.status(400).json({ error: "Invalid order items format" });
      }

      // Fetch the products based on the provided productId and quantity
      const products = await Promise.all(
        lineItems.map(async (item) => {
          let productData;
          const productParams = {
            TableName: PRODUCTS_TABLE,
            FilterExpression: "productId = :productId",
            ExpressionAttributeValues: {
              ":productId": item.productId,
            },
          };
          try {
            const productResponse = await docClient.send(new ScanCommand(productParams));
            if (productResponse.Items.length === 0) {
              console.error("Product not found.");
              return null;
            }
            productData = productResponse.Items[0];
          } catch (err) {
            console.error("Error fetching Product:", err);
            return null;
          }

          return {
            productId: productData.productId,
            productName: productData.productName,
            productPrice: productData.price,
            quantity: item.quantity,
            priceId: item.stripePriceId,
            productImage: productData.imageUrls,
          };
        })
      );

      const filteredProducts = products.filter((product) => product !== null);

      let orderData = {
        orderId: paymentIntent.id,
        customerId: customerData.customerId,
        customerName: customerData.name,
        customerEmail: paymentIntent.receipt_email,
        currency: paymentIntent.currency,
        paymentStatus: paymentIntent.status,
        amountTotal: paymentIntent.amount,
        ownerId: customerData.customerId,
        createdAt: new Date().toISOString(),
        products: filteredProducts,
      };

      orderData = removeUndefinedValues(orderData);

      const orderParams = {
        TableName: ORDERS_TABLE,
        Item: orderData,
      };

      try {
        await docClient.send(new PutCommand(orderParams));
        console.log("Order saved successfully:", orderData);
      } catch (err) {
        console.error("Error saving order:", err);
        return res.status(500).json({ message: "Error saving order" });
      }
      break;

    default:
      console.log(`Unhandled event type ${event.type}.`);
  }

  res.status(200).json({ received: true });
};
