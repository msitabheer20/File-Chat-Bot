export interface Message {
    id: string;
    content: string;
    role: 'user' | 'assistant';
    timestamp: Date;
  }
  
  export interface FileData {
    id: string;
    name: string;
    content: string;
    type: string;
    metadata?: {
      pages?: number;
      info?: any;
      totalChunks?: number;
    };
    chunks?: string[];
  }