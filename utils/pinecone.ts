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
    console.log('\n=== Document Processing Details ===');
    console.log('File ID:', fileId);
    console.log('Content length:', content.length);
    console.log('Content preview:', content.substring(0, 200) + '...');

    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    
    // Split the content into chunks
    console.log('\nSplitting content into chunks...');
    const docs = await textSplitter.createDocuments([content]);
    console.log('Number of chunks created:', docs.length);
    console.log('First chunk preview:', docs[0]?.pageContent.substring(0, 200) + '...');
    
    // Create embeddings for each chunk
    console.log('\nCreating embeddings for chunks...');
    const vectors = await Promise.all(
      docs.map(async (doc: Document, i: number) => {
        console.log(`Creating embedding for chunk ${i + 1}/${docs.length}`);
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

    console.log('\nUpserting vectors to Pinecone...');
    // Upsert to Pinecone
    await index.upsert(vectors);
    console.log('Successfully upserted vectors to Pinecone');

    console.log('\n=== Document Processing Summary ===');
    console.log('Total chunks processed:', vectors.length);
    console.log('Total vectors stored:', vectors.length);
    console.log('Average chunk size:', Math.round(content.length / vectors.length));

    return vectors.length;
  } catch (error) {
    console.error('Error upserting document to Pinecone:', error);
    throw error;
  }
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

    console.log('\n=== Final Results ===');
    console.log('Number of chunks after filtering:', results.length);
    console.log('Total text length:', results.reduce((acc, chunk) => acc + chunk.length, 0));
    console.log('First chunk preview:', results[0]?.substring(0, 200) + '...');

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