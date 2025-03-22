export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }
  
  export interface FileData {
    id: string;
    name: string;
    type: string;
    size: number;
    content?: string;
    metadata?: {
      pages?: number;
      info?: any;
      totalChunks?: number;
    };
  }