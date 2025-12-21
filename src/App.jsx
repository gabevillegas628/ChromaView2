import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Upload, FileText, AlertCircle } from 'lucide-react';
import ChromatogramViewer from './components/ChromatogramViewer';

function App() {
  const [fileData, setFileData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Check if running on native platform
  const isNative = Capacitor.isNativePlatform();

  // Handle native file picker (Android/iOS)
  const handleNativeFilePicker = async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await FilePicker.pickFiles({
        types: ['application/octet-stream', '*/*'],
        multiple: false,
        readData: true, // Important: read file data
      });

      if (!result.files || result.files.length === 0) {
        setLoading(false);
        return;
      }

      const file = result.files[0];

      // Check file extension
      const fileExtension = file.name.split('.').pop().toLowerCase();
      if (!['ab1', 'scf', 'abi'].includes(fileExtension)) {
        setError('Please select a valid chromatogram file (.ab1, .scf)');
        setLoading(false);
        return;
      }

      setFileName(file.name);

      // Convert base64 data to Uint8Array
      if (file.data) {
        const base64Data = file.data;
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        setFileData(bytes);
      } else {
        throw new Error('No file data received');
      }

      setLoading(false);
    } catch (err) {
      console.error('Error picking file:', err);
      setError('Failed to read file. Please try again.');
      setLoading(false);
    }
  };

  // Handle web file input (browser fallback)
  const handleWebFileSelect = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Check file extension
    const fileExtension = file.name.split('.').pop().toLowerCase();
    if (!['ab1', 'scf', 'abi'].includes(fileExtension)) {
      setError('Please select a valid chromatogram file (.ab1, .scf)');
      return;
    }

    setLoading(true);
    setError(null);
    setFileName(file.name);

    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      setFileData(uint8Array);
      setLoading(false);
    } catch (err) {
      console.error('Error reading file:', err);
      setError('Failed to read file. Please try again.');
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFileData(null);
    setFileName('');
    setError(null);
  };

  const triggerFileInput = () => {
    if (isNative) {
      handleNativeFilePicker();
    } else {
      document.getElementById('file-input').click();
    }
  };

  return (
    <div className="w-full h-screen bg-gradient-to-br from-teal-50 to-blue-50 flex flex-col">
      {/* Hidden file input - only used for web browsers */}
      <input
        id="file-input"
        type="file"
        accept=".ab1,.scf,.abi"
        onChange={handleWebFileSelect}
        className="hidden"
      />

      {/* Show chromatogram viewer if file is loaded */}
      {fileData ? (
        <div className="w-full h-full">
          <ChromatogramViewer
            fileData={fileData}
            fileName={fileName}
            onClose={handleClose}
          />
        </div>
      ) : (
        /* File selection screen */
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          {/* App Header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-4">
              <FileText className="w-16 h-16 text-teal-600" />
            </div>
            <h1 className="text-4xl font-bold text-gray-800 mb-2">
              ChromaViewer
            </h1>
            <p className="text-lg text-gray-600">
              View and analyze chromatogram files
            </p>
          </div>

          {/* Upload area */}
          <div className="w-full max-w-md">
            <button
              onClick={triggerFileInput}
              disabled={loading}
              className="w-full bg-white rounded-xl shadow-lg border-2 border-dashed border-teal-300 hover:border-teal-500 transition-all duration-200 p-12 group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex flex-col items-center space-y-4">
                <div className="p-4 bg-teal-100 rounded-full group-hover:bg-teal-200 transition-colors">
                  <Upload className="w-12 h-12 text-teal-600" />
                </div>
                <div>
                  <p className="text-xl font-semibold text-gray-700 mb-1">
                    {loading ? 'Loading...' : 'Select Chromatogram File'}
                  </p>
                  <p className="text-sm text-gray-500">
                    AB1 or SCF format
                  </p>
                </div>
              </div>
            </button>

            {/* Error message */}
            {error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Info section */}
            <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="font-semibold text-blue-900 mb-2 flex items-center">
                <FileText className="w-4 h-4 mr-2" />
                Supported Formats
              </h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• AB1 (Applied Biosystems)</li>
                <li>• SCF (Standard Chromatogram Format)</li>
              </ul>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-12 text-center text-sm text-gray-500">
            <p>v1.0.0</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
