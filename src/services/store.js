import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

/**
 * Put (create/overwrite) an item in the table.
 * @param {string} tableName
 * @param {Object} item
 */
export async function putItem(tableName, item, options = {}) {
  try {
    const params = {
      TableName: tableName,
      Item: item,
    };

    if (options.conditionExpression) {
      params.ConditionExpression = options.conditionExpression;
    }

    await docClient.send(new PutCommand(params));
    return item;
  } catch (error) {
    // Let ConditionalCheckFailedException propagate without logging (expected for dedup)
    if (error.name === 'ConditionalCheckFailedException') {
      throw error;
    }
    console.error(`[store.putItem] Error on ${tableName}:`, error.message);
    throw error;
  }
}

/**
 * Get a single item by primary key.
 * @param {string} tableName
 * @param {Object} key - e.g. { userId: '...', date: '...' }
 * @returns {Promise<Object|null>}
 */
export async function getItem(tableName, key) {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: key,
      }),
    );
    return result.Item || null;
  } catch (error) {
    console.error(`[store.getItem] Error on ${tableName}:`, error.message);
    throw error;
  }
}

/**
 * Query items with a key condition expression.
 * @param {string} tableName
 * @param {{expression: string, values: Object, names?: Object}} keyCondition
 * @param {{indexName?: string, limit?: number, scanForward?: boolean}} options
 * @returns {Promise<Object[]>}
 */
export async function queryItems(tableName, keyCondition, options = {}) {
  try {
    const params = {
      TableName: tableName,
      KeyConditionExpression: keyCondition.expression,
      ExpressionAttributeValues: keyCondition.values,
    };

    if (keyCondition.names) {
      params.ExpressionAttributeNames = keyCondition.names;
    }
    if (options.indexName) {
      params.IndexName = options.indexName;
    }
    if (options.limit) {
      params.Limit = options.limit;
    }
    if (typeof options.scanForward === 'boolean') {
      params.ScanIndexForward = options.scanForward;
    }

    const result = await docClient.send(new QueryCommand(params));
    return result.Items || [];
  } catch (error) {
    console.error(`[store.queryItems] Error on ${tableName}:`, error.message);
    throw error;
  }
}

/**
 * Update an item with an update expression.
 * @param {string} tableName
 * @param {Object} key
 * @param {string} updateExpression - e.g. "SET #s = :val"
 * @param {Object} values - ExpressionAttributeValues
 * @param {Object} [names] - ExpressionAttributeNames (optional)
 * @returns {Promise<Object>} Updated attributes.
 */
export async function updateItem(tableName, key, updateExpression, values, names) {
  try {
    const params = {
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    };

    if (names) {
      params.ExpressionAttributeNames = names;
    }

    const result = await docClient.send(new UpdateCommand(params));
    return result.Attributes;
  } catch (error) {
    console.error(`[store.updateItem] Error on ${tableName}:`, error.message);
    throw error;
  }
}

/**
 * Delete an item by primary key.
 * @param {string} tableName
 * @param {Object} key
 */
export async function deleteItem(tableName, key) {
  try {
    await docClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: key,
      }),
    );
  } catch (error) {
    console.error(`[store.deleteItem] Error on ${tableName}:`, error.message);
    throw error;
  }
}

/**
 * Scan a table (or GSI) with an optional filter expression.
 * @param {string} tableName
 * @param {string} indexName - GSI name.
 * @param {string} filterExpression - e.g. "active = :val"
 * @param {Object} values - ExpressionAttributeValues
 * @returns {Promise<Object[]>}
 */
export async function scanByIndex(tableName, indexName, filterExpression, values) {
  try {
    const params = {
      TableName: tableName,
      IndexName: indexName,
    };

    if (filterExpression) {
      params.FilterExpression = filterExpression;
      params.ExpressionAttributeValues = values;
    }

    // Paginate to handle > 1MB results
    let allItems = [];
    let lastKey;
    do {
      if (lastKey) params.ExclusiveStartKey = lastKey;
      const result = await docClient.send(new ScanCommand(params));
      allItems = allItems.concat(result.Items || []);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return allItems;
  } catch (error) {
    console.error(`[store.scanByIndex] Error on ${tableName}:`, error.message);
    throw error;
  }
}
