import { ReactNode } from 'react';

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  customContent?: ReactNode;
}

export interface FileData {
  id: string;
  name: string;
  type: string;
  size: number;
} 