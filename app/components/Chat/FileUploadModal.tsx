import { useState, useCallback, useRef } from 'react';
import { X, Upload, Trash2, FileIcon } from 'lucide-react';
import { FileData } from '@/types/chat';

interface FileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: FileData[];
  onFileUpload: (files: FileList | null) => void;
  onFileRemove: (fileId: string) => void;
  isPdfLibLoading: boolean;
}

export default function FileUploadModal({
  isOpen,
  onClose,
  files,
  onFileUpload,
  onFileRemove,
  isPdfLibLoading,
}: FileUploadModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = e.dataTransfer.files;
    
    if (selectedFiles) {
      // Combine existing files with new files
      const dt = new DataTransfer();
      Array.from(selectedFiles).forEach(file => dt.items.add(file));
      Array.from(droppedFiles).forEach(file => dt.items.add(file));
      setSelectedFiles(dt.files);
    } else {
      setSelectedFiles(droppedFiles);
    }
  }, [selectedFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = e.target.files;
    if (!newFiles) return;

    if (selectedFiles) {
      // Combine existing files with new files
      const dt = new DataTransfer();
      Array.from(selectedFiles).forEach(file => dt.items.add(file));
      Array.from(newFiles).forEach(file => dt.items.add(file));
      setSelectedFiles(dt.files);
    } else {
      setSelectedFiles(newFiles);
    }
  }, [selectedFiles]);

  const handleUpload = useCallback(() => {
    if (selectedFiles) {
      onFileUpload(selectedFiles);
      setSelectedFiles(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onClose();
    }
  }, [selectedFiles, onFileUpload, onClose]);

  const handleRemoveFile = useCallback((fileId: string) => {
    onFileRemove(fileId);
    setSelectedFiles(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onFileRemove]);

  const handleRemoveSelectedFile = useCallback((fileName: string) => {
    if (selectedFiles) {
      const remainingFiles = Array.from(selectedFiles).filter(file => file.name !== fileName);
      if (remainingFiles.length > 0) {
        const newFileList = new DataTransfer();
        remainingFiles.forEach(file => {
          newFileList.items.add(file);
        });
        setSelectedFiles(newFileList.files);
      } else {
        setSelectedFiles(null);
      }
    }
  }, [selectedFiles]);

  if (!isOpen) return null;

  const hasSelectedFiles = selectedFiles && selectedFiles.length > 0;
  const hasUploadedFiles = files.length > 0;

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-2xl shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">Upload Files</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isPdfLibLoading ? (
          <div className="flex flex-col items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400 mb-4"></div>
            <p className="text-gray-600 dark:text-gray-300">Loading PDF support...</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Please wait while we initialize the PDF reader.</p>
          </div>
        ) : (
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging 
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' 
                : 'border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              multiple
              accept=".pdf,.txt"
            />
            <Upload className="h-12 w-12 mx-auto text-indigo-400 dark:text-indigo-300 mb-4" />
            <p className="text-gray-600 dark:text-gray-300 mb-2">
              Drag and drop files here, or click to select files
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Supported formats: PDF, TXT (Max size: 5MB)
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
            >
              Select Files
            </button>
          </div>
        )}

        {(hasSelectedFiles || hasUploadedFiles) && (
          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {hasSelectedFiles ? 'Selected Files:' : 'Uploaded Files:'}
            </h3>
            <div className="space-y-2">
              {hasSelectedFiles ? (
                Array.from(selectedFiles!).map((file) => (
                  <div key={file.name} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-100 dark:border-gray-600">
                    <div className="flex items-center space-x-2">
                      <FileIcon className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{file.name}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveSelectedFile(file.name)}
                      className="p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors"
                      title="Remove file"
                    >
                      <Trash2 className="h-4 w-4 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400" />
                    </button>
                  </div>
                ))
              ) : (
                files.map((file) => (
                  <div key={file.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-100 dark:border-gray-600">
                    <div className="flex items-center space-x-2">
                      <FileIcon className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{file.name}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveFile(file.id)}
                      className="p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors"
                      title="Remove file"
                    >
                      <Trash2 className="h-4 w-4 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400" />
                    </button>
                  </div>
                ))
              )}
            </div>
            {hasSelectedFiles && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleUpload}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                >
                  Upload Files
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 