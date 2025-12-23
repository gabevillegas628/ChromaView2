import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Upload, AlertCircle, Activity } from 'lucide-react';
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
    <div className="w-full h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-cyan-50 flex flex-col">
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
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6 overflow-auto">
          <div className="w-full max-w-4xl flex flex-col items-center gap-6">
            {/* App Header */}
            <div className="text-center flex-shrink-0">
              <div className="flex items-center justify-center mb-4">
                <div className="relative">
                  {/* Glowing background circles */}
                  <div className="absolute inset-0 bg-blue-500 blur-2xl opacity-20 rounded-full animate-pulse"></div>
                  <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-15 rounded-full"></div>

                  {/* DNA/Activity icon with gradient background */}
                  <div className="relative bg-gradient-to-br from-blue-500 to-indigo-600 p-4 rounded-2xl shadow-xl">
                    <Activity className="w-10 h-10 sm:w-12 sm:h-12 text-white relative" strokeWidth={2.5} />
                  </div>
                </div>
              </div>
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                ChromaViewer
              </h1>
            </div>

            {/* Main content area with button and info side by side */}
            <div className="w-full flex flex-col md:flex-row gap-4 items-stretch">
              {/* Upload button */}
              <div className="flex-1">
                <button
                  onClick={triggerFileInput}
                  disabled={loading}
                  className="w-full h-full bg-white rounded-xl shadow-lg border-2 border-dashed border-blue-300 hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-100 active:scale-[0.99] transition-all duration-200 p-6 sm:p-8 group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex flex-col items-center justify-center gap-3 h-full">
                    <div className="relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-500 blur-lg opacity-20 rounded-full group-hover:opacity-30 transition-opacity"></div>
                      <div className="p-3 sm:p-4 bg-gradient-to-br from-blue-100 via-indigo-100 to-blue-200 rounded-full group-hover:from-blue-200 group-hover:via-indigo-200 group-hover:to-blue-300 transition-all relative shadow-md">
                        <Upload className="w-8 h-8 sm:w-10 sm:h-10 text-blue-700" strokeWidth={2} />
                      </div>
                    </div>
                    <div>
                      <p className="text-lg sm:text-xl font-semibold text-slate-800 mb-1">
                        {loading ? 'Loading...' : 'Select Chromatogram File'}
                      </p>
                      <p className="text-xs sm:text-sm text-slate-500">
                        AB1 or SCF format
                      </p>
                    </div>
                  </div>
                </button>

                {/* Error message */}
                {error && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}
              </div>

              {/* Info section - side by side on desktop */}
              <div className="flex-shrink-0 md:w-64">
                <div className="h-full p-5 bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 border-2 border-blue-200 rounded-xl shadow-md flex flex-col justify-center">
                  <h3 className="font-bold text-blue-900 mb-3 flex items-center text-sm">
                    <div className="w-1 h-5 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full mr-2"></div>
                    Supported Formats
                  </h3>
                  <ul className="text-sm text-blue-800 space-y-1.5 mb-4">
                    <li className="flex items-start">
                      <span className="text-blue-500 mr-2">▪</span>
                      <span>AB1 (Applied Biosystems)</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-blue-500 mr-2">▪</span>
                      <span>SCF (Standard Chromatogram Format)</span>
                    </li>
                  </ul>
                  <div className="pt-3 border-t border-blue-200">
                    <p className="text-xs text-blue-700 leading-relaxed">
                      🔒 All processing is done on your device - your data never leaves your browser.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="text-center text-sm text-slate-500 flex-shrink-0">
              <p>©Wildtype Technologies, LLC v1.0.0</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
