import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import OpenAI from 'openai';

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

export { pinecone };

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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
    // console.log('Number of chunks created:', docs.length);
    // console.log('First chunk preview:', docs[0]?.pageContent.substring(0, 200) + '...');
    
    // Create embeddings for each chunk
    // console.log('\nCreating embeddings for chunks...');
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

// Function to rerank chunks using OpenAI
async function rerankChunks(query: string, chunks: string[], topK: number = 5) {
  try {
    console.log('\n=== Reranking Chunks ===');
    console.log('Query:', query);
    console.log('Number of chunks to rerank:', chunks.length);

    // Create pairs of query and chunks for scoring
    const pairs = chunks.map(chunk => ({
      query,
      chunk,
    }));

    console.log('\nStarting scoring process for each chunk...');
    // Score each pair using OpenAI
    const scores = await Promise.all(
      pairs.map(async ({ query, chunk }, index) => {
        console.log(`\nScoring chunk ${index + 1}/${chunks.length}`);
        console.log('Chunk content:', chunk);
        
        const completion = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `You are a relevance scorer. Your task is to score how well the given chunk answers the query on a scale of 0 to 1.
              Scoring criteria:
              1.0 = Perfect match, directly answers the query
              0.7-0.9 = Very relevant, contains most of the answer
              0.4-0.6 = Moderately relevant, contains some useful information
              0.1-0.3 = Slightly relevant, contains minimal useful information
              0.0 = Not relevant at all
              
              IMPORTANT: Respond with ONLY a number between 0 and 1, with up to 2 decimal places. Do not include any other text or explanation.`
            },
            {
              role: 'user',
              content: `Query: ${query}\n\nChunk: ${chunk}\n\nScore:`
            }
          ],
          temperature: 0,
          max_tokens: 4,
        });

        const response = completion.choices[0].message.content?.trim() || '0';
        console.log('Raw OpenAI response:', response);
        
        // Parse and validate the score
        let score = parseFloat(response);
        if (isNaN(score) || score < 0 || score > 1) {
          console.log('Invalid score received, defaulting to 0');
          score = 0;
        }
        
        console.log(`Score assigned: ${score}`);
        console.log('Score interpretation:', 
          score === 1 ? 'Perfect match' :
          score >= 0.7 ? 'Very relevant' :
          score >= 0.4 ? 'Moderately relevant' :
          score >= 0.1 ? 'Slightly relevant' :
          'Not relevant'
        );
        
        return { chunk, score };
      })
    );

    console.log('\n=== Scoring Summary ===');
    console.log('All chunks scored. Sorting by relevance...');
    
    // Sort chunks by score and take top K
    const rerankedChunks = scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(item => item.chunk);

    console.log('\n=== Final Reranking Results ===');
    console.log(`Selected top ${topK} chunks after reranking`);
    rerankedChunks.forEach((chunk, index) => {
      const score = scores.find(s => s.chunk === chunk)?.score;
      console.log(`\nChunk ${index + 1} (Score: ${score})`);
      console.log('Content:', chunk);
    });

    return rerankedChunks;
  } catch (error) {
    console.error('Error during reranking:', error);
    // If reranking fails, return original chunks
    return chunks.slice(0, topK);
  }
}

export async function queryPinecone(query: string, fileId: string, topK: number = 5) {
  try {
    console.log('\n=== Pinecone Query Details ===');
    console.log('Query:', query);
    console.log('File ID:', fileId);
    console.log('Top K:', topK);

    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    
    // Create query embedding
    const queryEmbedding = await embeddings.embedQuery(query);
    console.log('Query embedding created, dimension:', queryEmbedding.length);
    
    // Query Pinecone with a larger topK to get more candidates for reranking
    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK: Math.max(topK * 2, 10), // Get more candidates for reranking
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
        console.log('Text length:', match.metadata?.text?.length || 0);
        console.log('Text preview:', match.metadata?.text?.substring(0, 200) + '...');
        console.log('Chunk Index:', match.metadata?.chunkIndex);
      });

      // Calculate score statistics
      const scores = queryResponse.matches.map(m => m.score || 0);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const maxScore = Math.max(...scores);
      const minScore = Math.min(...scores);
      console.log('\nScore Statistics:');
      console.log('Average score:', avgScore);
      console.log('Max score:', maxScore);
      console.log('Min score:', minScore);
    } else {
      console.log('No matches found in Pinecone');
    }

    // Extract the matched documents
    const chunks = queryResponse.matches
      ?.filter(match => match.score && match.score > 0.3)
      .map((match: any) => match.metadata?.text) || [];

    console.log('\n=== Chunk Filtering Results ===');
    console.log('Total chunks before filtering:', queryResponse.matches?.length || 0);
    console.log('Chunks after score filtering (>0.3):', chunks.length);
    console.log('Total text length in filtered chunks:', chunks.reduce((acc, chunk) => acc + (chunk?.length || 0), 0));

    if (chunks.length === 0) {
      console.log('\nNo relevant chunks found with score > 0.3');
      // Try a more lenient search without score filtering
      const lenientChunks = queryResponse.matches?.map((match: any) => match.metadata?.text) || [];
      console.log('All chunks found (without score filtering):', {
        numChunks: lenientChunks.length,
        totalLength: lenientChunks.reduce((acc, chunk) => acc + (chunk?.length || 0), 0),
        averageLength: Math.round(lenientChunks.reduce((acc, chunk) => acc + (chunk?.length || 0), 0) / lenientChunks.length)
      });
      return lenientChunks;
    }

    // Rerank the chunks
    console.log('\nStarting reranking process...');
    const rerankedChunks = await rerankChunks(query, chunks, topK);
    console.log('Reranking complete. Returning top chunks.');

    return rerankedChunks;
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