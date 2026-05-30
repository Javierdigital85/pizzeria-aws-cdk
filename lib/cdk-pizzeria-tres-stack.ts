import {
  Code,
  FilterCriteria,
  Function,
  Runtime,
  StartingPosition,
} from "aws-cdk-lib/aws-lambda";
import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Queue } from "aws-cdk-lib/aws-sqs";
import {
  DynamoEventSource,
  SqsEventSource,
} from "aws-cdk-lib/aws-lambda-event-sources";
import {
  AttributeType,
  BillingMode,
  StreamViewType,
  Table,
} from "aws-cdk-lib/aws-dynamodb";

export class CdkPizzeriaTresStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // SQS queues
    const pendingOrdersQueue = new Queue(this, "PendingOrdersQueue", {});
    const ordersToSendQueue = new Queue(this, "OrdersToSendQueue", {});

    // Dybamo tables
    const ordersTable = new Table(this, "orderTable", {
      partitionKey: { name: "orderId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_AND_OLD_IMAGES, // Agregamos stream a la tabla de dynamo
    });

    // Creamos una funcion de lambda
    const newOrderFunction = new Function(this, "NewOrderFunction", {
      runtime: Runtime.NODEJS_22_X,
      handler: "handler.newOrder", //Es un archivo de js que se llama handler que tiene un metodo que se llama newOrder
      code: Code.fromAsset("lib/functions"), // Estara ubicado en la carpeta lib dentro de una carpeta que se llama functions
      environment: {
        PENDING_ORDERS_QUEUE_URL: pendingOrdersQueue.queueUrl, //paso 2 pasar la url de la cola para poder enviar el mensaje
        ORDER_TABLE_NAME: ordersTable.tableName,
      },
    });
    // paso 1 darle permisos para que newOrderFunction envie mensaje a la cola
    pendingOrdersQueue.grantSendMessages(newOrderFunction);
    //ordersTable dale permiso a esta funcion para escribir
    ordersTable.grantWriteData(newOrderFunction);

    const getOrderFunction = new Function(this, "GetOrderFunction", {
      runtime: Runtime.NODEJS_22_X,
      handler: "handler.getOrder",
      code: Code.fromAsset("lib/functions"),
      environment: {
        ORDER_TABLE_NAME: ordersTable.tableName,
      },
    });

    ordersTable.grantReadData(getOrderFunction);

    const prepOrderFunction = new Function(this, "PrepOderFunction", {
      runtime: Runtime.NODEJS_22_X,
      handler: "handler.prepOrder",
      code: Code.fromAsset("lib/functions"),
      environment: {
        ORDER_TABLE_NAME: ordersTable.tableName,
      },
    });
    // Trigger: cuando llega un mensaje a pendingOrdersQueue, se ejecuta prepOrderFunction
    prepOrderFunction.addEventSource(
      new SqsEventSource(pendingOrdersQueue, {
        batchSize: 1, //Significa que procesa de a un mensaje por invocacion
      }),
    );
    // La funcion prepOrderFunction debe de tener permisos sobre la tabla ordersTable
    ordersTable.grantWriteData(prepOrderFunction);

    const sendOrderFunction = new Function(this, "SendOrderFunction", {
      runtime: Runtime.NODEJS_22_X,
      handler: "handler.sendOrder",
      code: Code.fromAsset("lib/functions"),
      environment: {
        ORDERS_TO_SEND_QUEUE_URL: ordersToSendQueue.queueUrl,
      },
    });
    // agregamos los permisos a esa funcion para poder enviar mensajes a esa cola
    ordersToSendQueue.grantSendMessages(sendOrderFunction);
    // Agregamos streams con DynamoEventSource. Cuando hay elementos en esta tabla, envialo a esta funcion
    sendOrderFunction.addEventSource(
      new DynamoEventSource(ordersTable, {
        startingPosition: StartingPosition.LATEST, //Empeza desde latest
        batchSize: 1,
        filters: [FilterCriteria.filter({ eventName: ["MODIFY"] })], //Solo se ejecuta esta funcion cuando se modifica un evento,Sino pones nada, se ejecuta al crear,eliminar o modificar un item en la tabla de dynamo.
      }),
    );
    // Permisos para leer el stream
    ordersTable.grantStreamRead(sendOrderFunction);

    // Creamos la api gateway
    const api = new apigateway.RestApi(this, "PizzeriaApi", {
      restApiName: "Pizzeria Service",
    });

    // Creamos el recurso orders con una root
    const orderResource = api.root.addResource("orders");
    // Asignamos este recurso a la funcion de lambda
    orderResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(newOrderFunction),
    );

    // orderResource
    //   .addResource("{orderId}")
    //   .addMethod("GET", new apigateway.LambdaIntegration(getOrderFunction));

    const orderId = orderResource.addResource("{orderId}");
    orderId.addMethod(
      "GET",
      new apigateway.LambdaIntegration(getOrderFunction),
    );
  }
}
// Los contructores que usamos son de nivel 2 , Function,RestApi.Son abstraciones de recursos de Cloudformation con muchos valores por defecto y no tenemos que estar definiedo un monton de cosas para poder trabajar con una funcion o con una api
