import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X, Move, Loader2, Minus, BarChart3, Maximize2 } from 'lucide-react';
import ChromatogramViewer from './ChromatogramViewer';

const DraggableChromogramModal = ({
  isOpen,
  onClose,
  chromatogramData,
  loading,
  fileName,
  fileType,
  onMinimize,
  onRestore,
  minimizedStackIndex = 0,
  onFocus,
  zIndex = 50
}) => {
  // Position state - start near top-right
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isMinimized, setIsMinimized] = useState(false);
  const [savedPosition, setSavedPosition] = useState(null);
  const [animatingMinimize, setAnimatingMinimize] = useState(false);
  const modalRef = useRef(null);

  // RAF throttling refs
  const rafPending = useRef(false);
  const latestTouchPos = useRef({ clientX: 0, clientY: 0 });

  // Resize RAF throttling refs
  const resizeRafPending = useRef(false);
  const latestResizePos = useRef({ clientX: 0, clientY: 0 });

  // Resize state
  const [size, setSize] = useState({ width: window.innerWidth * 0.8, height: window.innerHeight * 0.51 });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  // Initialize position on first open (centered)
  useEffect(() => {
    if (isOpen && modalRef.current) {
      const modalWidth = modalRef.current.offsetWidth;
      const modalHeight = modalRef.current.offsetHeight;
      const centerX = (window.innerWidth - modalWidth) / 2;
      const centerY = Math.max(50, (window.innerHeight - modalHeight) / 2);

      setPosition({ x: centerX, y: centerY });
    }
  }, [isOpen]);

  // Drag handlers adapted from WebcamCapture.jsx
  const handleMouseDown = useCallback((e) => {
    // Only allow dragging from the header
    if (e.target.closest('.drag-handle')) {
      // Prevent default touch behavior to stop scrolling
      if (e.touches) {
        e.preventDefault();
      }

      setIsDragging(true);

      // Unified touch/mouse coordinate extraction
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      setDragOffset({
        x: clientX - position.x,
        y: clientY - position.y
      });
    }
  }, [position]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !modalRef.current) return;

    e.preventDefault();

    // Unified touch/mouse coordinate extraction
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    // Store latest position
    latestTouchPos.current = { clientX, clientY };

    // Only schedule one RAF at a time to prevent flooding
    if (!rafPending.current) {
      rafPending.current = true;

      requestAnimationFrame(() => {
        rafPending.current = false;

        if (!modalRef.current) return;

        // Use the latest touch position
        const { clientX: latestX, clientY: latestY } = latestTouchPos.current;

        const modalWidth = modalRef.current.offsetWidth;
        const modalHeight = modalRef.current.offsetHeight;

        // Calculate new position
        let newX = latestX - dragOffset.x;
        let newY = latestY - dragOffset.y;

        // Boundary checking - keep modal on screen
        const minX = -modalWidth + 100; // Allow partial off-screen
        const maxX = window.innerWidth - 100;
        const minY = 0; // Don't allow above viewport
        const maxY = window.innerHeight - 60; // Keep header visible

        newX = Math.max(minX, Math.min(maxX, newX));
        newY = Math.max(minY, Math.min(maxY, newY));

        setPosition({ x: newX, y: newY });
      });
    }
  }, [isDragging, dragOffset]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Resize handlers (mouse and touch)
  const handleResizeStart = useCallback((e) => {
    if (e.target.closest('.resize-handle')) {
      // Prevent default touch behavior to stop scrolling
      if (e.touches) {
        e.preventDefault();
      }

      // Unified touch/mouse coordinate extraction
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      setIsResizing(true);
      setResizeStart({
        x: clientX,
        y: clientY,
        width: size.width,
        height: size.height
      });
    }
  }, [size]);

  const handleResizeMove = useCallback((e) => {
    if (!isResizing) return;

    e.preventDefault();

    // Unified touch/mouse coordinate extraction
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    // Store latest resize position
    latestResizePos.current = { clientX, clientY };

    // Throttle to 30 FPS for touch, 60 FPS for mouse
    // Touch events fire much more frequently and trigger expensive canvas redraws
    const isTouchEvent = e.touches !== undefined;
    const throttleDelay = isTouchEvent ? 33 : 16; // 30 FPS for touch, 60 FPS for mouse

    // Only schedule one update at a time to prevent flooding
    if (!resizeRafPending.current) {
      resizeRafPending.current = true;

      const scheduleUpdate = () => {
        resizeRafPending.current = false;

        // Use the latest resize position
        const { clientX: latestX, clientY: latestY } = latestResizePos.current;

        const deltaX = latestX - resizeStart.x;
        const deltaY = latestY - resizeStart.y;

        const newWidth = Math.max(600, Math.min(window.innerWidth - 100, resizeStart.width + deltaX));
        const newHeight = Math.max(400, Math.min(window.innerHeight - 100, resizeStart.height + deltaY));

        setSize({ width: newWidth, height: newHeight });
      };

      if (isTouchEvent) {
        // For touch, throttle to 30 FPS to reduce canvas redraw frequency
        setTimeout(scheduleUpdate, throttleDelay);
      } else {
        // For mouse, use RAF (60 FPS)
        requestAnimationFrame(scheduleUpdate);
      }
    }
  }, [isResizing, resizeStart]);

  const handleResizeUp = useCallback(() => {
    setIsResizing(false);
    // Trigger a final canvas redraw after resize completes
    // The ChromatogramViewer will pick this up via the isResizing prop change
  }, []);

  // Minimize/restore handlers
  const handleMinimize = useCallback(() => {
    setSavedPosition(position);
    setAnimatingMinimize(true);

    // Wait for animation to complete before actually minimizing
    setTimeout(() => {
      setIsMinimized(true);
      setAnimatingMinimize(false);
      if (onMinimize) {
        onMinimize();
      }
    }, 200);
  }, [position, onMinimize]);

  const handleRestore = useCallback(() => {
    setIsMinimized(false);

    if (savedPosition) {
      setPosition(savedPosition);
    }
    if (onRestore) {
      onRestore();
    }
  }, [savedPosition, onRestore]);

  // Set up event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleMouseMove, { passive: false });
      document.addEventListener('touchend', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchmove', handleMouseMove);
        document.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Set up event listeners for resizing (mouse and touch)
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeUp);
      document.addEventListener('touchmove', handleResizeMove, { passive: false });
      document.addEventListener('touchend', handleResizeUp);

      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeUp);
        document.removeEventListener('touchmove', handleResizeMove);
        document.removeEventListener('touchend', handleResizeUp);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeUp]);

  // Handle window resize - reposition if off-screen
  useEffect(() => {
    const handleResize = () => {
      if (!modalRef.current) return;

      const modalWidth = modalRef.current.offsetWidth;
      const maxX = window.innerWidth - 100;

      setPosition(prev => ({
        x: Math.min(prev.x, maxX),
        y: Math.min(prev.y, window.innerHeight - 60)
      }));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    // Container with no backdrop - allows interaction with background
    // Keep mounted but hidden when closed to preserve ChromatogramViewer state
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ display: isOpen ? 'block' : 'none', zIndex }}
    >
      {/* Minimized view - compact pill in bottom-right corner */}
      <div
        className="absolute right-6 pointer-events-auto"
        style={{
          bottom: `${24 + (minimizedStackIndex * 56)}px`,
          display: isMinimized ? 'block' : 'none'
        }}
      >
        <button
          onClick={handleRestore}
          className="flex items-center space-x-2 bg-teal-600 text-white px-3 py-2 rounded-full shadow-lg hover:bg-teal-700 transition-all duration-200 hover:shadow-xl transform hover:scale-105 w-52 text-sm"
        >
          <BarChart3 className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium truncate">
            {fileName ? `Chromatogram: ${fileName}` : 'Chromatogram Viewer'}
          </span>
        </button>
      </div>

      {/* Full modal view - Keep in DOM even when minimized to preserve state */}
      <div
        ref={modalRef}
        className={`absolute bg-white rounded-lg shadow-2xl pointer-events-auto flex flex-col ${animatingMinimize ? 'transition-all duration-200 ease-in-out' : ''}`}
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${size.width}px`,
          height: `${size.height}px`,
          display: isMinimized && !animatingMinimize ? 'none' : 'flex',
          touchAction: 'none',
          transform: (() => {
            if (animatingMinimize) {
              // Calculate translation to pill position (bottom-right corner)
              const pillX = window.innerWidth - 24 - 104; // right-6 (24px) + half pill width (104px for w-52)
              const pillY = window.innerHeight - (24 + (minimizedStackIndex * 56)) - 20; // bottom position + half pill height
              const translateX = pillX - position.x - (modalRef.current?.offsetWidth || 800) / 2;
              const translateY = pillY - position.y - (modalRef.current?.offsetHeight || 400) / 2;
              return `translate(${translateX}px, ${translateY}px) scale(0.8)`;
            }
            return 'scale(1)';
          })(),
          opacity: animatingMinimize ? 0 : 1
        }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleMouseDown}
        onClick={onFocus}
      >
        {/* Draggable Header */}
        <div
          className={`drag-handle bg-teal-600 px-4 py-2.5 text-white rounded-t-lg ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{ touchAction: 'none' }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <BarChart3 className="w-5 h-5" />
              <h3 className="text-lg font-bold">Chromatogram Viewer</h3>
              {fileName && (
                <span className="text-sm text-teal-100">- {fileName}</span>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleMinimize}
                className="text-white hover:text-gray-200 transition-colors p-1 rounded hover:bg-white/20"
                title="Minimize"
              >
                <Minus className="w-6 h-6" />
              </button>
              <button
                onClick={onClose}
                className="text-white hover:text-gray-200 transition-colors p-1 rounded hover:bg-white/20"
                title="Close"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-auto p-4 bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
              <span className="ml-3 text-gray-600">Loading chromatogram...</span>
            </div>
          ) : chromatogramData ? (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden h-full" style={{ touchAction: 'none' }}>
              <ChromatogramViewer
                fileData={chromatogramData}
                fileName={fileName}
                fileType={fileType}
                onClose={onClose}
                isResizing={isResizing}
              />
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-8 text-center">
              <div className="text-gray-400 mb-4">
                <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-gray-600">No chromatogram data available</p>
            </div>
          )}
        </div>

        {/* Resize Handle (mouse and touch) */}
        <div
          className="resize-handle absolute bottom-0 right-0 w-12 h-12 cursor-nwse-resize bg-teal-600 hover:bg-teal-700 rounded-tl-lg opacity-70 hover:opacity-100 transition-opacity flex items-center justify-center"
          onMouseDown={handleResizeStart}
          onTouchStart={handleResizeStart}
          style={{ touchAction: 'none' }}
        >
          <Maximize2 className="w-4 h-4 text-white" />
        </div>
      </div>
    </div>
  );
};

export default DraggableChromogramModal;
