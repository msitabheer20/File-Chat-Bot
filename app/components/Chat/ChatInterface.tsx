"use client"
import { useState, useRef, useEffect } from 'react';
import { Message, FileData } from '@/types/chat';
import { Trash2, FileIcon, Plus, Sun, Moon } from 'lucide-react';
import FileUploadModal from './FileUploadModal';
import { useTheme } from '@/contexts/ThemeContext';

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
  const [isPdfLibLoading, setIsPdfLibLoading] = useState(true);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { theme, setTheme, toggleTheme } = useTheme();

  const processPdfFile = async (file: File): Promise<string> => {
    if (!window.pdfjsLib) {
      throw new Error('PDF.js library not loaded');
    }

    try {
      console.log('\n=== PDF Processing Details ===');
      console.log('File name:', file.name);
      console.log('File size:', file.size);
      
      const arrayBuffer = await file.arrayBuffer();
      console.log('ArrayBuffer created, size:', arrayBuffer.byteLength);
      
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      console.log('PDF loaded, total pages:', pdf.numPages);
      
      let fullText = '';
      let hasText = false;
      let totalTextLength = 0;
      let pagesWithText = 0;

      for (let i = 1; i <= pdf.numPages; i++) {
        console.log(`\nProcessing page ${i}/${pdf.numPages}`);
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        
        console.log(`Page ${i} text length:`, pageText.length);
        console.log(`Page ${i} text preview:`, pageText.substring(0, 100) + '...');
        
        if (pageText.trim().length > 0) {
          hasText = true;
          fullText += pageText + '\n';
          totalTextLength += pageText.length;
          pagesWithText++;
          console.log(`Page ${i} contains text (${pageText.length} characters)`);
        } else {
          console.log(`Page ${i} contains no extractable text`);
        }
      }

      console.log('\n=== PDF Processing Summary ===');
      console.log('Total pages processed:', pdf.numPages);
      console.log('Pages with text:', pagesWithText);
      console.log('Total text length:', totalTextLength);
      console.log('Average text per page:', Math.round(totalTextLength / pagesWithText));
      console.log('Full text preview:', fullText.substring(0, 200) + '...');

      if (!hasText) {
        throw new Error('This PDF appears to be image-based or contains no extractable text. Please ensure the PDF contains actual text content.');
      }

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
          // Wait for PDF.js to be loaded
          let attempts = 0;
          const maxAttempts = 10;
          while (!isPdfLibLoaded && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
            // console.log(`Waiting for PDF.js to load... Attempt ${attempts}/${maxAttempts}`);
          }

          if (!isPdfLibLoaded) {
            throw new Error('PDF.js library failed to load. Please refresh the page and try again.');
          }

          console.log('PDF.js library loaded, processing file...');
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
          content: `Error uploading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
      
      // Check if the response includes a function call
      if (data.functionCall && data.functionCall.name === 'setTheme') {
        // Handle theme change function
        const { theme: newTheme } = data.functionCall.arguments;
        setTheme(newTheme);
        
        // Add message about the theme change
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: data.content,
            timestamp: Date.now(),
          },
          {
            id: (Date.now() + 1).toString(),
            role: 'system',
            content: `Theme changed to ${newTheme} mode.`,
            timestamp: Date.now() + 1,
          },
        ]);
      } else {
        // Normal message
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: data.content,
            timestamp: Date.now(),
          },
        ]);
      }
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

  // Add useEffect for PDF.js initialization
  useEffect(() => {
    const initPdfJs = async () => {
      try {
        setIsPdfLibLoading(true);
        // Load PDF.js script
        const script = document.createElement('script');
        script.src = '//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.async = true;
        
        script.onload = () => {
          // Set up the worker
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = '//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          setIsPdfLibLoaded(true);
          setIsPdfLibLoading(false);
          console.log('PDF.js library loaded successfully');
        };

        script.onerror = (error) => {
          console.error('Error loading PDF.js:', error);
          setIsPdfLibLoading(false);
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'system',
            content: 'Error loading PDF.js library. Please refresh the page.',
            timestamp: Date.now(),
          }]);
        };

        document.head.appendChild(script);
      } catch (error) {
        console.error('Error initializing PDF.js:', error);
        setIsPdfLibLoading(false);
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: 'Error initializing PDF.js library. Please refresh the page.',
          timestamp: Date.now(),
        }]);
      }
    };

    initPdfJs();
  }, []);

  return (
    <div className="flex flex-col h-[80vh] max-w-4xl mx-auto p-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
      {/* Theme toggle button */}
      <div className="flex justify-end mb-2">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? (
            <Moon className="h-5 w-5 text-gray-700" />
          ) : (
            <Sun className="h-5 w-5 text-gray-300" />
          )}
        </button>
      </div>

      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto space-y-4 p-4 border border-gray-300 rounded-lg mb-4 bg-gray-50 dark:bg-gray-900 dark:border-gray-700 shadow-sm"
      >
        {messages.length === 0 && (
          <div className="text-center text-gray-600 dark:text-gray-400">
            {isPdfLibLoading ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600 dark:border-indigo-400"></div>
                <span>Loading PDF support...</span>
              </div>
            ) : (
              'Click the plus icon to upload a document and ask questions about its content.'
            )}
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
                  : message.role === 'system'
                  ? 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600'
                  : 'bg-white text-gray-800 dark:bg-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700'
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
            <div className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-lg p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
              Thinking...
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 shadow-sm rounded-lg">
        <form onSubmit={handleSubmit} className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setIsUploadModalOpen(true)}
            className="p-2 hover:bg-indigo-50 dark:hover:bg-indigo-900 rounded-full transition-colors text-indigo-600 dark:text-indigo-400"
            title="Upload files"
            disabled={isPdfLibLoading}
          >
            <Plus className="h-5 w-5" />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 p-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-gray-500 dark:placeholder:text-gray-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
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
        isPdfLibLoading={isPdfLibLoading}
      />
    </div>
  );
}