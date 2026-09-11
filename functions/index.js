const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

setGlobalOptions({
  maxInstances: 10,
});

/* -----------------------------
   Helper functions
----------------------------- */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value) {
  return `R${Number(value || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function customerName(data) {
  return (
    `${data.customerName || ""} ${data.surname || ""}`.trim() ||
    "Customer"
  );
}

function orderReference(orderId) {
  return `#${orderId.substring(0, 8).toUpperCase()}`;
}

function formatItemsHtml(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "<p>No item details available.</p>";
  }

  return items
    .map((item) => {
      const name = item.product || item.name || "Item";
      const quantity = Number(item.quantity || 1);
      const price = money(item.price || 0);

      return `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee;">
            ${esc(name)}
          </td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center;">
            ${quantity}
          </td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">
            ${price}
          </td>
        </tr>
      `;
    })
    .join("");
}

function formatItemsText(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "No item details available.";
  }

  return items
    .map((item) => {
      const name = item.product || item.name || "Item";
      const quantity = Number(item.quantity || 1);
      const price = money(item.price || 0);

      return `${name} x ${quantity} - ${price}`;
    })
    .join("\n");
}

/* =============================
   NEW ORDER
   ============================= */

exports.onOrderCreated = onDocumentCreated(
  "orders/{orderId}",
  async (event) => {
    const snap = event.data;

    if (!snap) {
      return;
    }

    const data = snap.data();

    // Admin-created manual orders do not trigger automatic
    // customer/admin "new order" emails.
    if (data.createdByAdmin === true) {
      return;
    }

    if (!data.email) {
      console.log("Order has no customer email. Skipping email.");
      return;
    }

    const orderId = event.params.orderId;
    const reference = orderReference(orderId);
    const name = customerName(data);
    const total = money(data.total);
    const itemsHtml = formatItemsHtml(data.items);
    const itemsText = formatItemsText(data.items);

    /* -----------------------------
       Admin email
    ----------------------------- */

    const adminMailRef = db
      .collection("mail")
      .doc(`order-${orderId}-admin`);

    const adminMailExisting = await adminMailRef.get();

    if (!adminMailExisting.exists) {
      await adminMailRef.set({
        to: "s.samza085@gmail.com",

        message: {
          subject:
            "🛍️ New Order Received – TegoKgatso Leather Bags",

          text: `
New order received from TegoKgatso Leather Bags.

Customer: ${name}
Email: ${data.email || "N/A"}
Phone: ${data.phone || "N/A"}

Order Reference: ${reference}

Delivery Method: ${data.deliveryMethod || "N/A"}
Delivery Address: ${data.deliveryAddress || data.location || "N/A"}

Items:
${itemsText}

Total: ${total}

Payment Status: ${data.paymentStatus || "Awaiting Payment"}
Order Status: ${data.status || "Pending"}
          `.trim(),

          html: `
            <div style="font-family:Arial,sans-serif;color:#222;max-width:700px;margin:auto;">
              
              <div style="background:#111827;color:white;padding:24px;border-radius:10px 10px 0 0;">
                <h2 style="margin:0;">
                  🛍️ New Order Received
                </h2>
                <p style="margin:8px 0 0;">
                  TegoKgatso Leather Bags
                </p>
              </div>

              <div style="padding:24px;border:1px solid #eee;border-top:0;">

                <h3>Customer Details</h3>

                <p><strong>Name:</strong> ${esc(name)}</p>
                <p><strong>Email:</strong> ${esc(data.email)}</p>
                <p><strong>Phone:</strong> ${esc(data.phone || "N/A")}</p>

                <h3>Order Details</h3>

                <p><strong>Order Reference:</strong> ${esc(reference)}</p>

                <p>
                  <strong>Delivery Method:</strong>
                  ${esc(data.deliveryMethod || "N/A")}
                </p>

                <p>
                  <strong>Delivery Address:</strong>
                  ${esc(
                    data.deliveryAddress ||
                    data.location ||
                    "N/A"
                  )}
                </p>

                <table style="width:100%;border-collapse:collapse;margin-top:15px;">
                  <thead>
                    <tr>
                      <th style="text-align:left;padding-bottom:8px;">
                        Item
                      </th>
                      <th style="text-align:center;padding-bottom:8px;">
                        Qty
                      </th>
                      <th style="text-align:right;padding-bottom:8px;">
                        Price
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    ${itemsHtml}
                  </tbody>
                </table>

                <h3 style="margin-top:20px;">
                  Total: ${esc(total)}
                </h3>

                <p>
                  <strong>Payment Status:</strong>
                  ${esc(data.paymentStatus || "Awaiting Payment")}
                </p>

                <p>
                  <strong>Order Status:</strong>
                  ${esc(data.status || "Pending")}
                </p>

              </div>
            </div>
          `,
        },
      });

      console.log(`Admin order email created for ${orderId}`);
    }

    /* -----------------------------
       Customer confirmation email
    ----------------------------- */

    const customerMailRef = db
      .collection("mail")
      .doc(`order-${orderId}-customer`);

    const customerMailExisting = await customerMailRef.get();

    if (!customerMailExisting.exists) {
      await customerMailRef.set({
        to: data.email,

        message: {
          subject:
            "Thank You for Your Order – TegoKgatso Leather Bags",

          text: `
Dear ${name},

Thank you for your order from TegoKgatso Leather Bags.

Order Reference: ${reference}

Items:
${itemsText}

Total: ${total}

Delivery Method: ${data.deliveryMethod || "N/A"}

Order Status: ${data.status || "Pending"}

Payment Status:
${data.paymentStatus || "Awaiting Payment"}

We have received your order successfully.

You will receive another email whenever your order status changes.

Thank you for shopping with TegoKgatso Leather Bags.
          `.trim(),

          html: `
            <div style="font-family:Arial,sans-serif;color:#222;max-width:700px;margin:auto;">

              <div style="background:#111827;color:white;padding:24px;border-radius:10px 10px 0 0;">
                <h2 style="margin:0;">
                  Thank You for Your Order
                </h2>

                <p style="margin:8px 0 0;">
                  TegoKgatso Leather Bags
                </p>
              </div>

              <div style="padding:24px;border:1px solid #eee;border-top:0;">

                <p>
                  Dear ${esc(name)},
                </p>

                <p>
                  Thank you for your order from
                  <strong>TegoKgatso Leather Bags</strong>.
                </p>

                <p>
                  <strong>Order Reference:</strong>
                  ${esc(reference)}
                </p>

                <h3>Your Order</h3>

                <table style="width:100%;border-collapse:collapse;">
                  <thead>
                    <tr>
                      <th style="text-align:left;padding-bottom:8px;">
                        Item
                      </th>

                      <th style="text-align:center;padding-bottom:8px;">
                        Qty
                      </th>

                      <th style="text-align:right;padding-bottom:8px;">
                        Price
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    ${itemsHtml}
                  </tbody>
                </table>

                <h3>
                  Total: ${esc(total)}
                </h3>

                <p>
                  <strong>Delivery Method:</strong>
                  ${esc(data.deliveryMethod || "N/A")}
                </p>

                <p>
                  <strong>Order Status:</strong>
                  ${esc(data.status || "Pending")}
                </p>

                <p>
                  <strong>Payment Status:</strong>
                  ${esc(data.paymentStatus || "Awaiting Payment")}
                </p>

                <p>
                  Your order has been received successfully.
                  You will receive another email whenever your
                  order status changes.
                </p>

                <p>
                  Thank you for shopping with
                  <strong>TegoKgatso Leather Bags</strong>.
                </p>

              </div>
            </div>
          `,
        },
      });

      console.log(`Customer confirmation email created for ${orderId}`);
    }
  }
);

/* =============================
   ORDER STATUS / PAYMENT UPDATE
   ============================= */

exports.onOrderUpdated = onDocumentUpdated(
  "orders/{orderId}",
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();

    if (!before || !after) {
      return;
    }

    if (after.createdByAdmin === true) {
      return;
    }

    if (!after.email) {
      console.log("Order has no customer email. Skipping update email.");
      return;
    }

    const statusChanged =
      before.status !== after.status;

    const paymentChanged =
      before.paymentStatus !== after.paymentStatus;

    if (!statusChanged && !paymentChanged) {
      return;
    }

    const orderId = event.params.orderId;
    const reference = orderReference(orderId);
    const name = customerName(after);
    const total = money(after.total);

    const changes = [];

    if (statusChanged) {
      changes.push(
        `<p><strong>Order Status:</strong> ${esc(
          after.status || "N/A"
        )}</p>`
      );
    }

    if (paymentChanged) {
      changes.push(
        `<p><strong>Payment Status:</strong> ${esc(
          after.paymentStatus || "N/A"
        )}</p>`
      );
    }

    const changesText = [];

    if (statusChanged) {
      changesText.push(
        `Order Status: ${after.status || "N/A"}`
      );
    }

    if (paymentChanged) {
      changesText.push(
        `Payment Status: ${after.paymentStatus || "N/A"}`
      );
    }

    /*
      Use the Firestore/Cloud Event ID as part of the mail
      document ID so a retry of the same event is less likely
      to create another email.
    */
    const eventId = event.id || event.time || Date.now();

    const mailId =
      `status-${orderId}-${String(eventId).replace(
        /[^a-zA-Z0-9_-]/g,
        "_"
      )}`;

    const mailRef = db.collection("mail").doc(mailId);

    const existing = await mailRef.get();

    if (existing.exists) {
      console.log(`Notification already created: ${mailId}`);
      return;
    }

    await mailRef.set({
      to: after.email,

      message: {
        subject:
          "📦 Order Update – TegoKgatso Leather Bags",

        text: `
Dear ${name},

There has been an update to your TegoKgatso Leather Bags order.

Order Reference: ${reference}

${changesText.join("\n")}

Total: ${total}

Delivery Method: ${after.deliveryMethod || "N/A"}

We will continue to keep you updated as your order progresses.

Thank you for shopping with TegoKgatso Leather Bags.
        `.trim(),

        html: `
          <div style="font-family:Arial,sans-serif;color:#222;max-width:700px;margin:auto;">

            <div style="background:#111827;color:white;padding:24px;border-radius:10px 10px 0 0;">
              <h2 style="margin:0;">
                📦 Order Update
              </h2>

              <p style="margin:8px 0 0;">
                TegoKgatso Leather Bags
              </p>
            </div>

            <div style="padding:24px;border:1px solid #eee;border-top:0;">

              <p>
                Dear ${esc(name)},
              </p>

              <p>
                There has been an update to your
                TegoKgatso Leather Bags order.
              </p>

              <p>
                <strong>Order Reference:</strong>
                ${esc(reference)}
              </p>

              ${changes.join("")}

              <p>
                <strong>Total:</strong>
                ${esc(total)}
              </p>

              <p>
                <strong>Delivery Method:</strong>
                ${esc(after.deliveryMethod || "N/A")}
              </p>

              <p>
                We will continue to keep you updated as
                your order progresses.
              </p>

              <p>
                Thank you for shopping with
                <strong>TegoKgatso Leather Bags</strong>.
              </p>

            </div>
          </div>
        `,
      },
    });

    console.log(
      `Customer status notification created for ${orderId}`
    );
  }
);