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

export async function upsertDocument(fileId: string, content: string) {
  try {
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    
    // Split the content into chunks
    const docs = await textSplitter.createDocuments([content]);
    
    // Create embeddings for each chunk
    const vectors = await Promise.all(
      docs.map(async (doc: Document, i: number) => {
        const embedding = await embeddings.embedQuery(doc.pageContent);
        return {
          id: `${fileId}-${i}`,
          values: embedding,
          metadata: {
            text: doc.pageContent,
            fileId,
            chunkIndex: i,
          },
        };
      })
    );

    // Upsert to Pinecone
    await index.upsert(vectors);

    return vectors.length;
  } catch (error) {
    console.error('Error upserting document to Pinecone:', error);
    throw error;
  }
}

export async function queryPinecone(query: string, fileId: string, topK: number = 5) {
  try {
    console.log('Querying Pinecone:', {
      query,
      fileId,
      topK
    });

    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    
    // Create query embedding
    const queryEmbedding = await embeddings.embedQuery(query);
    console.log('Query embedding created, dimension:', queryEmbedding.length);
    
    // Query Pinecone with more lenient settings
    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK,
      filter: {
        fileId: { $eq: fileId },
      },
      includeMetadata: true,
      minScore: 0.5, // Lower threshold for matches
    });

    console.log('Pinecone query response:', {
      matchesFound: queryResponse.matches?.length || 0,
      scores: queryResponse.matches?.map(m => ({
        score: m.score,
        preview: m.metadata?.text?.substring(0, 100) + '...'
      })) || []
    });

    // Extract and return the matched documents
    const results = queryResponse.matches
      ?.filter(match => match.score && match.score > 0.5) // Filter low-quality matches
      .map((match: any) => match.metadata?.text) || [];

    console.log('Extracted text chunks:', {
      numChunks: results.length,
      totalLength: results.reduce((acc, chunk) => acc + chunk.length, 0),
      chunkPreviews: results.map(chunk => chunk.substring(0, 100) + '...')
    });

    if (results.length === 0) {
      console.log('No relevant chunks found with score > 0.5');
      // Try a more lenient search without score filtering
      const lenientResults = queryResponse.matches?.map((match: any) => match.metadata?.text) || [];
      console.log('All chunks found:', {
        numChunks: lenientResults.length,
        totalLength: lenientResults.reduce((acc, chunk) => acc + chunk.length, 0)
      });
    }

    return results;
  } catch (error) {
    console.error('Error querying Pinecone:', error);
    throw error;
  }
}

export async function deleteDocument(fileId: string) {
  try {
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    
    // Delete all vectors associated with the fileId
    await index.deleteMany({
      filter: {
        fileId: { $eq: fileId },
      },
    });
  } catch (error) {
    console.error('Error deleting document from Pinecone:', error);
    throw error;
  }
} 