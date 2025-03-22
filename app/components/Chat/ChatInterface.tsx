"use client"
import { useState, useRef, useEffect } from 'react';
import { Message, FileData } from '@/types/chat';
import Script from 'next/script';
import { Trash2, FileIcon, Plus } from 'lucide-react';
import FileUploadModal from './FileUploadModal';

declare global {
  interface Window {
    pdfjsLib: any;
  }
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<FileData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [isPdfLibLoaded, setIsPdfLibLoaded] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const processPdfFile = async (file: File): Promise<string> => {
    if (!window.pdfjsLib) {
      throw new Error('PDF.js library not loaded');
    }

    try {
      console.log('Starting PDF processing for:', file.name);
      const arrayBuffer = await file.arrayBuffer();
      console.log('ArrayBuffer created, size:', arrayBuffer.byteLength);
      
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      console.log('PDF loaded, pages:', pdf.numPages);
      
      let fullText = '';
      let hasText = false;

      for (let i = 1; i <= pdf.numPages; i++) {
        console.log(`Processing page ${i}/${pdf.numPages}`);
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        
        if (pageText.trim().length > 0) {
          hasText = true;
          fullText += pageText + '\n';
          console.log(`Page ${i} text length:`, pageText.length);
        } else {
          console.log(`Page ${i} contains no extractable text`);
        }
      }

      if (!hasText) {
        throw new Error('This PDF appears to be image-based or contains no extractable text. Please ensure the PDF contains actual text content.');
      }

      console.log('Total extracted text length:', fullText.length);
      return fullText;
    } catch (error) {
      console.error('Error processing PDF:', error);
      throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files?.length) return;

    setIsProcessing(true);
    setProcessingStatus('Processing files...');

    // Add single upload message
    setMessages(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        role: 'system',
        content: 'Uploading file...',
        timestamp: Date.now(),
      },
    ]);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 5 * 1024 * 1024) {
          setMessages(prev => [
            ...prev,
            {
              id: Date.now().toString(),
              role: 'system',
              content: `File ${file.name} is too large. Maximum size is 5MB.`,
              timestamp: Date.now(),
            },
          ]);
          continue;
        }

        const fileData: FileData = {
          id: Math.random().toString(36).substring(7),
          name: file.name,
          type: file.type,
          size: file.size,
        };

        setFiles(prev => [...prev, fileData]);

        if (file.type === 'application/pdf') {
          if (!isPdfLibLoaded) {
            throw new Error('PDF.js library is still loading. Please try again in a moment.');
          }
          const content = await processPdfFile(file);
          if (!content.trim()) {
            throw new Error('No text content could be extracted from the PDF. The file might be image-based or have security restrictions.');
          }

          // Process document through Pinecone
          const response = await fetch('/api/process-document', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileId: fileData.id,
              content,
              metadata: {
                pages: (await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise).numPages,
              },
            }),
          });

          if (!response.ok) {
            throw new Error('Failed to process document in vector database');
          }

          const result = await response.json();
          console.log('Document processing result:', result);
        } else {
          // Handle text files
          const text = await file.text();

          // Process document through Pinecone
          const response = await fetch('/api/process-document', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileId: fileData.id,
              content: text,
              metadata: {
                filename: file.name,
                type: file.type,
                size: file.size,
              },
            }),
          });

          if (!response.ok) {
            throw new Error('Failed to process document in vector database');
          }

          const result = await response.json();
          console.log('Document processing result:', result);
        }
      }

      // Add completion message
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'system',
          content: 'File uploaded successfully. You can now ask questions about its content.',
          timestamp: Date.now(),
        },
      ]);
    } catch (error) {
      console.error('Error processing files:', error);
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'system',
          content: 'Error uploading file. Please try again.',
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
      },
    ]);
    setIsLoading(true);

    try {
      console.log('Starting chat request...');
      console.log('Files state:', files);
      console.log('User message:', userMessage);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          files: files.map(f => ({
            id: f.id,
            name: f.name,
          })),
        }),
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        console.error('Error response data:', errorData);
        throw new Error(errorData?.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Success response data:', data);
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: data.content,
          timestamp: Date.now(),
        },
      ]);
    } catch (error) {
      console.error('Full error details:', error);
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'An error occurred while processing your request.'}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveFile = async (fileId: string) => {
    try {
      // Remove file from Pinecone
      const response = await fetch('/api/delete-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileId }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete file');
      }

      // Remove file from local state
      setFiles(prevFiles => prevFiles.filter(file => file.id !== fileId));
      
      // Add system message about file removal
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'system',
          content: 'File removed successfully. You can continue chatting with the remaining files.',
          timestamp: Date.now(),
        },
      ]);
    } catch (error) {
      console.error('Error removing file:', error);
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'system',
          content: 'Failed to remove file. Please try again.',
          timestamp: Date.now(),
        },
      ]);
    }
  };

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    // Setup Pinecone index when component mounts
    const setupPinecone = async () => {
      try {
        const response = await fetch('/api/setup-pinecone', {
          method: 'POST',
        });
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.details || data.error || 'Failed to setup Pinecone index');
        }
        console.log('Pinecone index setup completed');
      } catch (error) {
        console.error('Error setting up Pinecone:', error);
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: `Error setting up Pinecone: ${error instanceof Error ? error.message : 'Unknown error'}. Please check your environment variables and try again.`,
          timestamp: Date.now(),
        }]);
      }
    };

    setupPinecone();
  }, []);

  return (
    <div className="flex flex-col h-[80vh] max-w-4xl mx-auto p-4 bg-gradient-to-b from-gray-50 to-white">
      <Script
        src="//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
        onLoad={() => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = '//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          setIsPdfLibLoaded(true);
        }}
      />
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto space-y-4 p-4 border border-gray-200 rounded-lg mb-4 bg-white shadow-sm"
      >
        {messages.length === 0 && (
          <div className="text-center text-gray-500">
            Click the plus icon to upload a document and ask questions about its content.
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-3 shadow-sm ${
                message.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-50 text-gray-800 border border-gray-100'
              }`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              <span className="text-xs opacity-70 mt-1 block">
                {new Date(message.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-50 text-gray-800 rounded-lg p-3 border border-gray-100 shadow-sm">
              Thinking...
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 p-4 bg-white shadow-sm rounded-lg">
        <form onSubmit={handleSubmit} className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setIsUploadModalOpen(true)}
            className="p-2 hover:bg-indigo-50 rounded-full transition-colors text-indigo-600"
            title="Upload files"
          >
            <Plus className="h-5 w-5" />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 p-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            disabled={isProcessing}
          />
          <button
            type="submit"
            disabled={isProcessing || !input.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            Send
          </button>
        </form>
      </div>

      <FileUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        files={files}
        onFileUpload={handleFileUpload}
        onFileRemove={handleRemoveFile}
      />
    </div>
  );
}