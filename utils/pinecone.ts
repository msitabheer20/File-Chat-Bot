import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

if (!process.env.PINECONE_API_KEY) {
  throw new Error('Missing PINECONE_API_KEY environment variable');
}
if (!process.env.PINECONE_ENVIRONMENT) {
  throw new Error('Missing PINECONE_ENVIRONMENT environment variable');
}
if (!process.env.PINECONE_INDEX_NAME) {
  throw new Error('Missing PINECONE_INDEX_NAME environment variable');
}

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
});

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
  separators: ['\n\n', '\n', ' ', ''],
});

// Function to create a new Pinecone index with the correct dimensions
export async function createPineconeIndex() {
  try {
    // Delete existing index if it exists
    try {
      await pinecone.deleteIndex(process.env.PINECONE_INDEX_NAME!);
      console.log('Deleted existing index');
    } catch (error) {
      console.log('No existing index to delete');
    }

    // Create new index with 1536 dimensions (OpenAI's embedding dimension)
    await pinecone.createIndex({
      name: process.env.PINECONE_INDEX_NAME!,
      spec: {
        pod: {
          environment: process.env.PINECONE_ENVIRONMENT as string,
          podType: 'p1.x1',
          replicas: 1,
          shards: 1,
          dimension: 1536,
          metric: 'cosine',
        },
      },
    });

    console.log('Created new index with 1536 dimensions');
  } catch (error) {
    console.error('Error creating Pinecone index:', error);
    throw error;
  }
}

export async function upsertDocument(fileId: string, content: string, metadata: any = {}) {
  const chunks = splitIntoChunks(content);
  const embeddings = await createEmbeddings(chunks);
  const vectors = chunks.map((chunk, i) => ({
    id: `${fileId}-${i}`,
    values: embeddings[i],
    metadata: {
      ...metadata,
      fileId,
      chunk,
    },
  }));

  const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
  await index.upsert(vectors);
}

export async function queryPinecone(query: string, fileId: string, topK: number = 5) {
  try {
    console.log('=== Pinecone Query Details ===');
    console.log('Query:', query);
    console.log('File ID:', fileId);
    console.log('Top K:', topK);

    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    
    // Create query embedding
    const queryEmbedding = await embeddings.embedQuery(query);
    console.log('Query embedding created, dimension:', queryEmbedding.length);
    
    // Query Pinecone
    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK,
      filter: {
        fileId: { $eq: fileId },
      },
      includeMetadata: true,
    });

    console.log('\n=== Pinecone Query Results ===');
    console.log('Total matches found:', queryResponse.matches?.length || 0);
    
    if (queryResponse.matches && queryResponse.matches.length > 0) {
      console.log('\nMatch Details:');
      queryResponse.matches.forEach((match, index) => {
        console.log(`\nMatch ${index + 1}:`);
        console.log('Score:', match.score);
        console.log('Text Preview:', match.metadata?.text?.substring(0, 200) + '...');
        console.log('Chunk Index:', match.metadata?.chunkIndex);
      });
    } else {
      console.log('No matches found in Pinecone');
    }

    // Extract and return the matched documents, filtering by score after getting results
    const results = queryResponse.matches
      ?.filter(match => match.score && match.score > 0.3)
      .map((match: any) => match.metadata?.text) || [];

    // console.log('\n=== Final Results ===');
    // console.log('Number of chunks after filtering:', results.length);
    // console.log('Total text length:', results.reduce((acc, chunk) => acc + chunk.length, 0));
    // console.log('First chunk preview:', results[0]?.substring(0, 200) + '...');

    if (results.length === 0) {
      console.log('\nNo relevant chunks found with score > 0.3');
      // Try a more lenient search without score filtering
      const lenientResults = queryResponse.matches?.map((match: any) => match.metadata?.text) || [];
      console.log('All chunks found (without score filtering):', {
        numChunks: lenientResults.length,
        totalLength: lenientResults.reduce((acc, chunk) => acc + chunk.length, 0)
      });
      return lenientResults;
    }

    return results;
  } catch (error) {
    console.error('Error querying Pinecone:', error);
    throw error;
  }
}

export async function deleteDocument(fileId: string) {
  try {
    console.log('Starting document deletion process for fileId:', fileId);
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);

    // Get all vectors for this file
    const queryResponse = await index.query({
      vector: new Array(1536).fill(0), // Zero vector to get all matches
      topK: 1000,
      includeMetadata: true,
    });

    if (!queryResponse.matches) {
      console.log('No vectors found in index');
      return;
    }

    // Filter vectors by fileId in memory
    const vectorsToDelete = queryResponse.matches
      .filter(match => match.metadata?.fileId === fileId)
      .map(match => match.id);

    if (vectorsToDelete.length === 0) {
      console.log('No vectors found for fileId:', fileId);
      return;
    }

    console.log(`Found ${vectorsToDelete.length} vectors to delete`);

    // Delete vectors one at a time
    for (const id of vectorsToDelete) {
      try {
        await index.deleteOne(id);
        console.log(`Deleted vector with ID: ${id}`);
      } catch (error) {
        console.error(`Error deleting vector ${id}:`, error);
        // Continue with other vectors even if one fails
      }
    }

    console.log('Successfully deleted vectors from Pinecone');
  } catch (error) {
    console.error('Error deleting document from Pinecone:', error);
    throw error;
  }
}

export async function verifyDocumentStorage(fileId: string) {
  try {
    console.log('\n=== Verifying Document Storage ===');
    console.log('Checking storage for file ID:', fileId);

    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    
    // Query for all vectors with this fileId
    const queryResponse = await index.query({
      vector: new Array(1536).fill(0), // Zero vector to get all matches
      topK: 1000,
      filter: {
        fileId: { $eq: fileId },
      },
      includeMetadata: true,
    });

    console.log('Found vectors:', queryResponse.matches?.length || 0);
    if (queryResponse.matches && queryResponse.matches.length > 0) {
      console.log('First vector preview:', queryResponse.matches[0].metadata?.text?.substring(0, 200) + '...');
      console.log('Average score:', queryResponse.matches.reduce((acc, m) => acc + (m.score || 0), 0) / queryResponse.matches.length);
    }

    return queryResponse.matches?.length || 0;
  } catch (error) {
    console.error('Error verifying document storage:', error);
    throw error;
  }
} 