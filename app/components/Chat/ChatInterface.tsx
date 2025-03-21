"use client"
import { useState, useRef, useEffect } from 'react';
import { Message, FileData } from '@/types/chat';
import Script from 'next/script';

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;

    const uploadedFiles = Array.from(e.target.files);
    const processedFiles: FileData[] = [];
    setIsProcessing(true);

    for (const file of uploadedFiles) {
      if (file.size > 5 * 1024 * 1024) {
        setMessages(prev => [...prev, {
          id: Math.random().toString(36).substring(7),
          content: `File ${file.name} is too large. Maximum size is 5MB`,
          role: 'assistant',
          timestamp: new Date(),
        }]);
        continue;
      }

      try {
        setProcessingStatus(`Processing ${file.name}...`);
        let content = '';

        if (file.type === 'application/pdf') {
          if (!isPdfLibLoaded) {
            throw new Error('PDF.js library is still loading. Please try again in a moment.');
          }
          content = await processPdfFile(file);
          if (!content.trim()) {
            throw new Error('No text content could be extracted from the PDF. The file might be image-based or have security restrictions.');
          }
          console.log('PDF content extracted:', content.substring(0, 100) + '...');
        } else {
          content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target?.result as string);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
          });
        }

        const fileId = Math.random().toString(36).substring(7);
        const fileData: FileData = {
          id: fileId,
          name: file.name,
          content: content,
          type: file.type,
          metadata: file.type === 'application/pdf' ? {
            pages: (await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise).numPages,
          } : undefined,
        };

        console.log('Processed file data:', {
          name: fileData.name,
          type: fileData.type,
          contentLength: fileData.content.length,
          metadata: fileData.metadata
        });

        // Process document through Pinecone
        setProcessingStatus(`Storing ${file.name} in vector database...`);
        const response = await fetch('/api/process-document', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileId,
            content,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to process document in vector database');
        }

        const result = await response.json();
        console.log('Document processing result:', result);

        processedFiles.push(fileData);

      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
        setMessages(prev => [...prev, {
          id: Math.random().toString(36).substring(7),
          content: `Error processing ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}. Please ensure the PDF contains actual text content and is not image-based or password-protected.`,
          role: 'assistant',
          timestamp: new Date(),
        }]);
      }
    }

    if (processedFiles.length > 0) {
      setFiles([...files, ...processedFiles]);
      setMessages(prev => [...prev, {
        id: Math.random().toString(36).substring(7),
        content: `Successfully processed ${processedFiles.length} file(s). You can now ask questions about their content.`,
        role: 'assistant',
        timestamp: new Date(),
      }]);
    }
    setIsProcessing(false);
    setProcessingStatus('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const newMessage: Message = {
      id: Math.random().toString(36).substring(7),
      content: input,
      role: 'user',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Log the request payload
      const requestPayload = {
        message: input,
        files: files.map(f => ({
          id: f.id,
          name: f.name,
          type: f.type,
          contentLength: f.content.length
        }))
      };
      console.log('Sending request payload:', requestPayload);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          content: data.response,
          role: 'assistant',
          timestamp: new Date(),
        },
      ]);
    } catch (error: any) {
      console.error('Error details:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          content: `Error: ${error.message || 'Something went wrong'}`,
          role: 'assistant',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
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
          id: Math.random().toString(36).substring(7),
          content: `Error setting up Pinecone: ${error instanceof Error ? error.message : 'Unknown error'}. Please check your environment variables and try again.`,
          role: 'assistant',
          timestamp: new Date(),
        }]);
      }
    };

    setupPinecone();
  }, []);

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4">
      <Script
        src="//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
        onLoad={() => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = '//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          setIsPdfLibLoaded(true);
        }}
      />
      <div className="mb-4">
        <h1 className="text-2xl font-bold mb-4">Document Analysis Chatbot</h1>
        <div className="space-y-2">
          <input
            type="file"
            multiple
            accept=".pdf,.txt,.json,.csv,.md,.js,.ts,.html,.css,.xml,.yaml"
            onChange={handleFileUpload}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          {isProcessing && (
            <div className="text-sm text-blue-600">
              {processingStatus}
            </div>
          )}
          <div className="mt-2 space-y-1">
            {files.map((file) => (
              <div key={file.id} className="text-sm text-gray-600 bg-gray-100 p-2 rounded flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <span>{file.name}</span>
                  {file.type === 'application/pdf' && file.metadata && (
                    <span className="text-xs text-gray-500">
                      {file.metadata.pages} pages
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto mb-4 space-y-4 p-4 border rounded-lg"
      >
        {messages.length === 0 && (
          <div className="text-center text-gray-500">
            Upload a document and ask questions about its content.
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
              className={`max-w-[70%] rounded-lg p-3 ${
                message.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-800'
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-200 text-gray-800 rounded-lg p-3">
              Analyzing documents...
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          placeholder="Ask a question about the documents..."
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  );
}