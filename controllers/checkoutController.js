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
  const {
    orderedItems,
    shippingAddress,
    customer,
    customerEmail,
    promoCode,
    amount,
  } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: "usd",
      customer: customer,
      shipping: {
        name: shippingAddress.name,
        phone: shippingAddress.phone,
        address: {
          city: shippingAddress.city,
          country: shippingAddress.country,
          line1: shippingAddress.line1,
          line2: shippingAddress.line2,
          postal_code: shippingAddress.postal_code,
          state: shippingAddress.state,
        },
      },
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
  } else if (typeof obj === "object" && obj !== null) {
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

      let customerData;
      const customerParams = {
        TableName: CUSTOMERS_TABLE,
        FilterExpression: "email = :email",
        ExpressionAttributeValues: {
          ":email": paymentIntent.receipt_email,
        },
      };

      try {
        const customerResponse = await docClient.send(
          new ScanCommand(customerParams)
        );
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
      } catch (err) {
        console.error("Error parsing line items:", err.message);
        return res.status(400).json({ error: "Invalid order items format" });
      }

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
            const productResponse = await docClient.send(
              new ScanCommand(productParams)
            );
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

      // Burada `newStatus`'ı tanımlıyoruz
      const newStatus = "Order received";
      const timestamp = new Date().toISOString();

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
        currentStatus: newStatus, // Burada newStatus'u kullanıyoruz
        statusHistory: [
          {
            status: newStatus,
            timestamp,
          },
        ],
        shipping: {
          name: paymentIntent.shipping.name,
          phone: paymentIntent.shipping.phone,
          address: {
            city: paymentIntent.shipping.address.city,
            country: paymentIntent.shipping.address.country,
            line1: paymentIntent.shipping.address.line1,
            line2: paymentIntent.shipping.address.line2,
            postal_code: paymentIntent.shipping.address.postal_code,
            state: paymentIntent.shipping.address.state,
          },
        },
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
