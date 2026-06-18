"use client";

import type React from "react";

import { useCallback, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DocumentUploadProps {
  onDocumentsUploaded: (files: File[]) => void;
}

export default function DocumentUpload({
  onDocumentsUploaded,
}: DocumentUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      const droppedFiles = Array.from(e.dataTransfer.files);
      const newFiles = [...files, ...droppedFiles];
      setFiles(newFiles);
      onDocumentsUploaded(newFiles);
    },
    [files, onDocumentsUploaded],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const selectedFiles = Array.from(e.target.files);
        const newFiles = [...files, ...selectedFiles];
        setFiles(newFiles);
        onDocumentsUploaded(newFiles);
      }
    },
    [files, onDocumentsUploaded],
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const removeFile = useCallback(
    (index: number) => {
      const newFiles = files.filter((_, i) => i !== index);
      setFiles(newFiles);
      onDocumentsUploaded(newFiles);
    },
    [files, onDocumentsUploaded],
  );

  return (
    <div className="space-y-4">
      <div
        className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          dragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        tabIndex={0}
        role="button"
        aria-label="Upload files"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-50 pointer-events-auto"
        />
        <div className="flex flex-col items-center gap-2 pointer-events-none">
          <Upload className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Drop files here or click to browse
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Supports PDF, DOCX, TXT, and image files
            </p>
          </div>
        </div>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center justify-between p-3 bg-muted rounded-lg"
            >
              <span className="text-sm text-foreground truncate flex-1">
                {file.name}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeFile(index)}
                className="ml-2"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
