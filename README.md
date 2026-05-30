# 🍕 CDK Pizzeria

A serverless pizza-ordering backend built with the [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html) in TypeScript. It exposes a REST API to create and retrieve orders, then processes them asynchronously through an event-driven pipeline using **API Gateway**, **AWS Lambda**, **Amazon DynamoDB**, and **Amazon SQS**.

## Architecture

```
                 POST /orders                       ┌──────────────────────┐
   Client ───────────────────────►  API Gateway ───►│   newOrderFunction   │
      │           GET  /orders/{id}       │         └──────────┬───────────┘
      │                                   │                     │ save order
      │                                   │            ┌────────▼─────────┐
      │                                   └───────────►│   OrdersTable    │
      │                                    getOrder    │   (DynamoDB)     │
      │                                                └────┬────────┬────┘
      │                                                     │        │ stream (MODIFY)
      │                              send to queue          │        ▼
      │                          ┌────────────────┐         │   ┌──────────────────┐
      └──────────────────────────┤ PendingOrders  │◄────────┘   │ sendOrderFunction│
                                 │     Queue      │             └────────┬─────────┘
                                 └───────┬────────┘                      │
                                         │ triggers                      ▼
                                 ┌───────▼────────┐            ┌──────────────────┐
                                 │ prepOrderFunc  │           │  OrdersToSend    │
                                 │ (status →      │           │      Queue       │
                                 │   COMPLETED)   │           └──────────────────┘
                                 └────────────────┘
```

### Order flow

1. **Create order** — A client sends `POST /orders`. The `newOrderFunction` generates a unique `orderId`, stores the order in the `OrdersTable` DynamoDB table, and pushes a message onto the `PendingOrdersQueue`.
2. **Prepare order** — A message on `PendingOrdersQueue` triggers `prepOrderFunction`, which updates the order's `order_status` to `COMPLETED` in DynamoDB.
3. **Send order** — The DynamoDB stream emits a `MODIFY` event when the order is updated. This triggers `sendOrderFunction`, which forwards the completed order to the `OrdersToSendQueue` for downstream delivery.
4. **Retrieve order** — A client can fetch an order at any time with `GET /orders/{orderId}`, served by `getOrderFunction`.

## AWS resources

| Resource | Logical name | Purpose |
|----------|--------------|---------|
| REST API | `PizzeriaApi` | Public entry point (`Pizzeria Service`) |
| Lambda | `NewOrderFunction` | Creates orders, writes to DynamoDB, enqueues to SQS |
| Lambda | `GetOrderFunction` | Reads an order from DynamoDB |
| Lambda | `PrepOrderFunction` | Consumes pending orders and marks them `COMPLETED` |
| Lambda | `SendOrderFunction` | Reacts to DynamoDB stream updates and enqueues completed orders |
| DynamoDB | `OrdersTable` | Stores orders (`orderId` partition key, pay-per-request, streams enabled) |
| SQS | `PendingOrdersQueue` | Holds newly created orders awaiting preparation |
| SQS | `OrdersToSendQueue` | Holds completed orders ready to be sent |

All Lambda functions run on the **Node.js 22.x** runtime, and least-privilege permissions are granted per function (write, read, send-message, and stream-read as needed).

## API reference

### Create an order

```http
POST /orders
Content-Type: application/json

{
  "pizza": "Margarita",
  "customerId": "abc123"
}
```

**Response `200 OK`**

```json
{
  "message": {
    "orderId": "generated-uuid",
    "pizza": "Margarita",
    "customerId": "abc123"
  }
}
```

Returns `400 Bad Request` if the request body is not valid JSON.

### Get an order

```http
GET /orders/{orderId}
```

**Response `200 OK`**

```json
{
  "orderId": "generated-uuid",
  "pizza": "Margarita",
  "customerId": "abc123",
  "order_status": "COMPLETED"
}
```

Returns `404 Not Found` if the order does not exist, or `500 Internal Server Error` on failure.

## Project structure

```
.
├── bin/                        # CDK app entry point
├── lib/
│   ├── cdk-pizzeria-tres-stack.ts      # Stack: API, Lambdas, DynamoDB, SQS
│   └── functions/
│       ├── handler.js          # Lambda handlers (newOrder, getOrder, prepOrder, sendOrder)
│       └── package.json        # Lambda dependencies (uuid)
├── test/                       # Jest tests
├── cdk.json                    # CDK Toolkit configuration
└── package.json
```

## Prerequisites

- [Node.js](https://nodejs.org/) 22.x or later
- An AWS account with credentials configured (`aws configure`)
- The AWS CDK Toolkit (`npm install -g aws-cdk`) or use the bundled `npx cdk`

## Getting started

Install dependencies for both the CDK app and the Lambda functions:

```bash
npm install
npm install --prefix lib/functions
```

Bootstrap your AWS environment (only required once per account/region):

```bash
npx cdk bootstrap
```

Deploy the stack:

```bash
npx cdk deploy
```

After deployment, the CDK output prints the API Gateway base URL you can use to call the endpoints above.

## Useful commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run watch` | Watch for changes and recompile |
| `npm run test`  | Run the Jest unit tests |
| `npx cdk synth` | Emit the synthesized CloudFormation template |
| `npx cdk diff`  | Compare the deployed stack with the current state |
| `npx cdk deploy`| Deploy the stack to your default AWS account/region |
| `npx cdk destroy` | Tear down the deployed stack |

## Notes

This project uses **L2 constructs**, which are higher-level abstractions over raw CloudFormation resources with sensible defaults, so you don't have to wire up every detail of each Lambda, queue, or table manually.
