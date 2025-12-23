import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Download, Eye, EyeOff, Menu, X, Scissors, Repeat2 } from 'lucide-react';
import restrictionEnzymes from '../data/restrictionEnzymes.json';

const ChromatogramViewer = ({ fileData, fileName, onClose, isResizing = false }) => {
  console.log('ChromatogramViewer props:', { fileData, fileName }); // Debug log
  const canvasRef = useRef(null);
  const offscreenCanvasRef = useRef(null); // For pre-rendered horizontal layout

  // CLEAN TOUCH SCROLLING ARCHITECTURE
  // Single source of truth for scroll position during animations
  const scrollOffsetRef = useRef(0); // normalized 0-1, used during touch/inertia

  // Touch state
  const touchState = useRef({
    isActive: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTime: 0,
    hasMoved: false,
    velocitySamples: [] // [{velocity, time}, ...]
  });

  // Inertia state
  const inertiaState = useRef({
    isActive: false,
    velocity: 0,
    rafId: null,
    lastTime: 0
  });

  // Click prevention
  const preventClickRef = useRef(false);
  const lastTouchEndTimeRef = useRef(0);

  // Touch selection ref - track if this touch is for selection vs scrolling
  const selectionTouchRef = useRef({
    isSelecting: false,
    startX: 0,
    startY: 0,
    identifier: null,
    canvasX: 0,
    canvasY: 0,
    timeoutId: null
  });

  // Auto-scroll ref for edge scrolling during selection
  const autoScrollRef = useRef({
    isActive: false,
    direction: 0, // -1 for left/up, 1 for right/down
    rafId: null
  });

  const [parsedData, setParsedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1.5);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [showChannels, setShowChannels] = useState({
    A: true,
    T: true,
    G: true,
    C: true
  });
  const [qualityThreshold, setQualityThreshold] = useState(20);
  const [hoveredPosition, setHoveredPosition] = useState(null);

  // Add state for selected position
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [selectedNucleotide, setSelectedNucleotide] = useState(null);


  // Add state for editing
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [editedPositions, setEditedPositions] = useState(new Set());

  // Add state for confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingEdit, setPendingEdit] = useState(null); // {position, oldBase, newBase}

  // Sidebar visibility for mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Restriction enzyme mapping
  const [selectedEnzymes, setSelectedEnzymes] = useState([]);
  const [restrictionSites, setRestrictionSites] = useState([]);
  const [showRestrictionSites, setShowRestrictionSites] = useState(false);
  const [enzymeSearchQuery, setEnzymeSearchQuery] = useState('');

  // Layout mode: 'horizontal' or 'wrapped'
  const [layoutMode, setLayoutMode] = useState('horizontal');

  // Reverse complement mode
  const [showReverseComplement, setShowReverseComplement] = useState(false);

  // Sequence search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // ORF Finder
  const [showORFs, setShowORFs] = useState(false);
  const [selectedFrames, setSelectedFrames] = useState(['+1', '+2', '+3']); // Default: show forward frames
  const [minORFLength, setMinORFLength] = useState(100); // Minimum ORF length in base pairs
  const [detectedORFs, setDetectedORFs] = useState([]);
  const [selectedORF, setSelectedORF] = useState(null);

  // BLAST region selection
  const [selectionRange, setSelectionRange] = useState(null); // {start: number, end: number}
  const selectionRangeRef = useRef(null); // Ref for immediate access during drawing
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPosition, setDragStartPosition] = useState(null);

  // Add keyboard shortcuts for editing bases
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (selectedPosition === null || isEditing || showConfirmModal) return;
      
      // CRITICAL: Ignore keypresses if user is typing in a form field
      // Use e.target instead of document.activeElement for reliability
      const targetElement = e.target;
      if (
        targetElement.tagName === 'INPUT' ||
        targetElement.tagName === 'TEXTAREA' ||
        targetElement.isContentEditable ||
        targetElement.getAttribute('contenteditable') === 'true'
      ) {
        return;
      }
      
      const key = e.key.toUpperCase();
      if (['A', 'T', 'G', 'C', 'N'].includes(key)) {
        // Show confirmation modal before editing
        const oldBase = parsedData.baseCalls[selectedPosition];
        setPendingEdit({
          position: selectedPosition,
          oldBase: oldBase,
          newBase: key
        });
        setShowConfirmModal(true);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [selectedPosition, isEditing, parsedData, showConfirmModal]);

  // Function to confirm the base edit
  const confirmBaseEdit = () => {
    if (!pendingEdit) return;

    const { position, newBase } = pendingEdit;
    const newBaseCalls = [...parsedData.baseCalls];
    newBaseCalls[position] = newBase;

    const newParsedData = {
      ...parsedData,
      baseCalls: newBaseCalls,
      sequence: newBaseCalls.join('')
    };

    setEditedPositions(prev => new Set([...prev, position]));
    setParsedData(newParsedData);
    setSelectedNucleotide(newBase);
    
    console.log(`Edited position ${position + 1} from ${pendingEdit.oldBase} to ${newBase}`);
    
    // Close modal and clear pending edit
    setShowConfirmModal(false);
    setPendingEdit(null);
  };

  // Function to cancel the base edit
  const cancelBaseEdit = () => {
    setShowConfirmModal(false);
    setPendingEdit(null);
  };



  useEffect(() => {
    if (fileData) {
      parseChromatogramFile(fileData);
    }
  }, [fileData]);

  // FIX: Improved effect with proper cleanup and timing
  useEffect(() => {
    if (parsedData && canvasRef.current) {
      // CRITICAL: Skip automatic redraw during active touch scrolling or inertia
      // This prevents state changes (like hoveredPosition) from causing jumps
      if (touchState.current.isActive || inertiaState.current.isActive) {
        return; // Skip this render, let manual drawChromatogram() handle it
      }

      // Use requestAnimationFrame for smoother rendering on mobile
      let rafId = requestAnimationFrame(() => {
        // Double RAF to ensure layout has settled (important for mobile)
        rafId = requestAnimationFrame(() => {
          drawChromatogram();
        });
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [parsedData, zoomLevel, scrollPosition, showChannels, qualityThreshold, selectedPosition, hoveredPosition, isEditing, restrictionSites, showRestrictionSites, layoutMode, showReverseComplement, searchMatches, currentMatchIndex, showORFs, detectedORFs, selectedORF, selectionRange, isDragging]);

  // FIX: Add cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup canvas context if component unmounts
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    };
  }, []);

  // Handle page visibility changes (critical for mobile app stability)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && parsedData && canvasRef.current) {
        // Page became visible again, force a redraw
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            drawChromatogram();
          });
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [parsedData]);

  // Add this useEffect for wheel event handling (only in horizontal mode)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Only enable custom wheel handler in horizontal mode
    // In wrapped mode, use native browser scrolling
    if (layoutMode !== 'horizontal') return;

    const handleWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const scrollDelta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      const scrollAmount = scrollDelta > 0 ? 0.003 : -0.003;

      setScrollPosition(prev => Math.max(0, Math.min(1, prev + scrollAmount)));

      return false;
    };

    // Add with passive: false to ensure preventDefault works
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [parsedData, layoutMode]); // Re-attach when parsedData or layoutMode changes

  // Add ResizeObserver to handle container size changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;

    let rafId = null;

    const resizeObserver = new ResizeObserver(() => {
      // Cancel any pending redraw
      if (rafId) {
        cancelAnimationFrame(rafId);
      }

      // Redraw on next frame - RAF naturally throttles to 60fps
      rafId = requestAnimationFrame(() => {
        drawChromatogram();
        rafId = null;
      });
    });

    resizeObserver.observe(canvas.parentElement);

    return () => {
      resizeObserver.disconnect();
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [parsedData, zoomLevel, scrollPosition, showChannels, isResizing, restrictionSites, showRestrictionSites, layoutMode]); // Redraw when these change

  // Ensure a final clean redraw when resize completes
  useEffect(() => {
    if (!isResizing && parsedData) {
      // Use RAF for consistent timing on mobile
      let rafId = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(() => {
          drawChromatogram();
        });
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [isResizing, parsedData]);

  // Inertial scrolling animation
  // Stop inertia animation
  const stopInertia = useCallback(() => {
    if (inertiaState.current.rafId !== null) {
      cancelAnimationFrame(inertiaState.current.rafId);
      inertiaState.current.rafId = null;
    }
    inertiaState.current.isActive = false;

    // Commit final position to React state for UI elements (scrollbar, etc)
    setScrollPosition(scrollOffsetRef.current);
  }, []);

  // Start inertia animation with given velocity
  const startInertia = useCallback((velocity) => {
    if (!parsedData) return;

    // Stop any existing inertia
    stopInertia();

    inertiaState.current.isActive = true;
    inertiaState.current.velocity = velocity;
    inertiaState.current.lastTime = performance.now();

    const inertiaStep = () => {
      const currentTime = performance.now();
      const deltaTime = currentTime - inertiaState.current.lastTime;
      inertiaState.current.lastTime = currentTime;

      // Apply friction (exponential decay)
      const FRICTION = 0.95; // Lower = more friction
      inertiaState.current.velocity *= Math.pow(FRICTION, deltaTime / 16);

      // Stop if velocity too small
      if (Math.abs(inertiaState.current.velocity) < 0.01) {
        stopInertia();
        return;
      }

      // Calculate scroll delta
      const canvas = canvasRef.current;
      if (!canvas || !parsedData) {
        stopInertia();
        return;
      }

      const traceLengths = Object.values(parsedData.traces).map(trace => trace.length);
      const dataLength = Math.max(...traceLengths);
      const visiblePoints = Math.floor(canvas.width / zoomLevel);
      const scrollableRange = dataLength - visiblePoints;

      if (scrollableRange <= 0) {
        stopInertia();
        return;
      }

      // Update position
      const pixelsMoved = inertiaState.current.velocity * deltaTime;
      const scrollDelta = (pixelsMoved / canvas.width) * (visiblePoints / scrollableRange);
      scrollOffsetRef.current = Math.max(0, Math.min(1, scrollOffsetRef.current + scrollDelta));

      // Render immediately (fast: just copies from pre-rendered offscreen canvas)
      drawChromatogram();

      // Continue or stop at boundary
      if (scrollOffsetRef.current <= 0 || scrollOffsetRef.current >= 1) {
        stopInertia();
        return;
      }

      inertiaState.current.rafId = requestAnimationFrame(inertiaStep);
    };

    inertiaState.current.rafId = requestAnimationFrame(inertiaStep);
  }, [parsedData, zoomLevel, stopInertia]);

  // Helper function to convert canvas coordinates to base call position
  const getBasePositionFromCanvas = useCallback((canvasX, canvasY) => {
    if (!parsedData) return null;

    const canvas = canvasRef.current;
    const displayData = showReverseComplement ? getReverseComplementData(parsedData) : parsedData;
    const traceLengths = Object.values(displayData.traces).map(trace => trace.length);
    const maxTraceLength = Math.max(...traceLengths);

    let startIndex, endIndex;

    if (layoutMode === 'wrapped') {
      // Wrapped mode: determine which row was clicked
      const rowHeight = 200;
      const tracePointsPerRow = Math.floor(canvas.width / zoomLevel);
      const row = Math.floor(canvasY / rowHeight);

      startIndex = row * tracePointsPerRow;
      endIndex = Math.min(startIndex + tracePointsPerRow, maxTraceLength);
    } else {
      // Horizontal mode: use scroll position
      const dataLength = maxTraceLength;
      const visiblePoints = Math.floor(canvas.width / zoomLevel);
      startIndex = Math.floor(scrollPosition * (dataLength - visiblePoints));
      endIndex = Math.min(startIndex + visiblePoints, dataLength);
    }

    // Find closest base call position
    let closestPosition = null;
    let closestDistance = Infinity;

    for (let i = 0; i < displayData.baseCalls.length; i++) {
      const peakPosition = displayData.peakLocations && displayData.peakLocations[i]
        ? displayData.peakLocations[i]
        : (i * maxTraceLength / displayData.baseCalls.length);

      if (peakPosition < startIndex || peakPosition > endIndex) continue;

      const baseX = ((peakPosition - startIndex) / (endIndex - startIndex)) * canvas.width;
      const distance = Math.abs(canvasX - baseX);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestPosition = i;
      }
    }

    // Return position only if within reasonable proximity (50px threshold)
    return (closestPosition !== null && closestDistance < 50) ? closestPosition : null;
  }, [parsedData, showReverseComplement, layoutMode, zoomLevel, scrollPosition]);

  // Auto-scroll functions for edge scrolling during selection
  const startAutoScroll = useCallback((direction, mode = 'horizontal') => {
    if (autoScrollRef.current.isActive) return;

    autoScrollRef.current.isActive = true;
    autoScrollRef.current.direction = direction;

    const scroll = () => {
      if (!autoScrollRef.current.isActive) return;

      if (mode === 'horizontal') {
        // Horizontal mode - scroll left/right
        const scrollSpeed = 0.0015; // Slower speed for better control during selection
        const newPosition = scrollOffsetRef.current + (autoScrollRef.current.direction * scrollSpeed);
        scrollOffsetRef.current = Math.max(0, Math.min(1, newPosition));
        setScrollPosition(scrollOffsetRef.current);
        drawChromatogram();
      } else {
        // Wrapped mode - scroll up/down
        const canvas = canvasRef.current;
        const container = canvas.parentElement;
        if (container) {
          const scrollSpeed = 5; // pixels per frame
          container.scrollTop += autoScrollRef.current.direction * scrollSpeed;
        }
      }

      autoScrollRef.current.rafId = requestAnimationFrame(scroll);
    };

    autoScrollRef.current.rafId = requestAnimationFrame(scroll);
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current.rafId) {
      cancelAnimationFrame(autoScrollRef.current.rafId);
      autoScrollRef.current.rafId = null;
    }
    autoScrollRef.current.isActive = false;
    autoScrollRef.current.direction = 0;
  }, []);

  // CLEAN TOUCH HANDLERS - only for horizontal mode
  const handleCanvasTouchStart = useCallback((e) => {
    if (layoutMode !== 'horizontal') return;
    if (e.touches.length !== 1) return;

    e.stopPropagation();

    // Stop any ongoing inertia (commits scrollOffsetRef to state)
    stopInertia();

    // Initialize touch state
    const touch = e.touches[0];
    touchState.current = {
      isActive: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastTime: performance.now(),
      hasMoved: false,
      velocitySamples: []
    };

    // CRITICAL: Don't reset scrollOffsetRef from scrollPosition!
    // If we were in inertia, scrollOffsetRef is already correct and scrollPosition is stale.
    // If we were idle, scrollOffsetRef already equals scrollPosition.
    // In both cases, keep scrollOffsetRef as-is!

    // Clear hover to avoid conflicts
    setHoveredPosition(null);

    // Start long-press timer for selection
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (touch.clientX - rect.left) * scaleX;
    const canvasY = (touch.clientY - rect.top) * scaleY;

    selectionTouchRef.current = {
      isSelecting: false,
      startX: touch.clientX,
      startY: touch.clientY,
      identifier: touch.identifier,
      canvasX,
      canvasY
    };

    // Start a timeout for long press detection (500ms)
    const longPressTimeout = setTimeout(() => {
      // Only trigger if touch hasn't moved (hasMoved is still false)
      if (!touchState.current.hasMoved) {
        const position = getBasePositionFromCanvas(canvasX, canvasY);

        if (position !== null) {
          selectionTouchRef.current.isSelecting = true;
          setIsDragging(true);
          setDragStartPosition(position);
          selectionRangeRef.current = null;
          setSelectionRange(null);

          // Provide haptic feedback if available
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
        }
      }
    }, 500);

    selectionTouchRef.current.timeoutId = longPressTimeout;
  }, [layoutMode, stopInertia, getBasePositionFromCanvas]);

  const handleCanvasTouchMove = useCallback((e) => {
    if (layoutMode !== 'horizontal') return;
    if (!touchState.current.isActive || e.touches.length !== 1) return;

    const canvas = canvasRef.current;
    if (!canvas || !parsedData) return;

    const touch = e.touches[0];
    const currentTime = performance.now();

    // Check if this is a tap vs scroll gesture
    const deltaX = Math.abs(touch.clientX - touchState.current.startX);
    const deltaY = Math.abs(touch.clientY - touchState.current.startY);
    const MOVE_THRESHOLD = 5;

    if (!touchState.current.hasMoved && (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD)) {
      touchState.current.hasMoved = true;
      preventClickRef.current = true;

      // Cancel long-press timer if scrolling started and not yet selecting
      if (!selectionTouchRef.current.isSelecting && selectionTouchRef.current.timeoutId) {
        clearTimeout(selectionTouchRef.current.timeoutId);
        selectionTouchRef.current.timeoutId = null;
      }
    }

    // If we're in selection mode, update the selection range instead of scrolling
    if (selectionTouchRef.current.isSelecting && isDragging) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = (touch.clientX - rect.left) * scaleX;
      const canvasY = (touch.clientY - rect.top) * scaleY;

      // Check if touch is near edge for auto-scroll
      const edgeThreshold = 50; // pixels from edge
      const touchScreenX = touch.clientX - rect.left;

      if (touchScreenX < edgeThreshold && scrollOffsetRef.current > 0) {
        // Near left edge - scroll left
        startAutoScroll(-1, 'horizontal');
      } else if (touchScreenX > rect.width - edgeThreshold && scrollOffsetRef.current < 1) {
        // Near right edge - scroll right
        startAutoScroll(1, 'horizontal');
      } else {
        // Not near edge - stop auto-scroll
        stopAutoScroll();
      }

      const currentPosition = getBasePositionFromCanvas(canvasX, canvasY);

      if (currentPosition !== null && dragStartPosition !== null) {
        const start = Math.min(dragStartPosition, currentPosition);
        const end = Math.max(dragStartPosition, currentPosition);
        const newRange = { start, end };

        // Update both state and ref (ref is used for immediate drawing)
        selectionRangeRef.current = newRange;
        setSelectionRange(newRange);

        // Manually redraw to show updated selection (useEffect skips during touchState.isActive)
        drawChromatogram();
      }

      e.preventDefault();
      e.stopPropagation();
      return; // Don't scroll while selecting
    }

    // Only prevent default after we know it's a scroll (not a tap)
    if (touchState.current.hasMoved) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Calculate movement
    const pixelsMoved = touchState.current.lastX - touch.clientX;
    const timeDelta = currentTime - touchState.current.lastTime;

    if (timeDelta > 0 && touchState.current.hasMoved) {
      // Record velocity sample
      const velocity = pixelsMoved / timeDelta;
      touchState.current.velocitySamples.push({ velocity, time: currentTime });

      // Keep only recent samples (last 5)
      if (touchState.current.velocitySamples.length > 5) {
        touchState.current.velocitySamples.shift();
      }

      // Calculate scroll delta
      const traceLengths = Object.values(parsedData.traces).map(trace => trace.length);
      const dataLength = Math.max(...traceLengths);
      const visiblePoints = Math.floor(canvas.width / zoomLevel);
      const scrollableRange = dataLength - visiblePoints;

      if (scrollableRange > 0) {
        const scrollDelta = (pixelsMoved / canvas.width) * (visiblePoints / scrollableRange);
        scrollOffsetRef.current = Math.max(0, Math.min(1, scrollOffsetRef.current + scrollDelta));

        // Render immediately (fast: just copies from pre-rendered offscreen canvas)
        drawChromatogram();
      }
    }

    // Update for next move event
    touchState.current.lastX = touch.clientX;
    touchState.current.lastTime = currentTime;
  }, [layoutMode, parsedData, zoomLevel, getBasePositionFromCanvas, isDragging, dragStartPosition, startAutoScroll, stopAutoScroll]);

  const handleCanvasTouchEnd = useCallback((e) => {
    if (layoutMode !== 'horizontal') return;
    if (!touchState.current.isActive) return;

    e.stopPropagation();

    // Clear long-press timer if it exists
    if (selectionTouchRef.current.timeoutId) {
      clearTimeout(selectionTouchRef.current.timeoutId);
      selectionTouchRef.current.timeoutId = null;
    }

    // If we were selecting, finalize the selection
    if (selectionTouchRef.current.isSelecting && isDragging) {
      stopAutoScroll(); // Stop any auto-scrolling
      setIsDragging(false);
      setDragStartPosition(null);
      selectionTouchRef.current.isSelecting = false;
      touchState.current.isActive = false;
      setScrollPosition(scrollOffsetRef.current);
      return;
    }

    const wasTap = !touchState.current.hasMoved;

    // Handle tap - allow click to fire
    if (wasTap) {
      preventClickRef.current = false;
      lastTouchEndTimeRef.current = 0;
      touchState.current.isActive = false;
      setScrollPosition(scrollOffsetRef.current);
      return;
    }

    // Handle scroll - block clicks for a short time
    lastTouchEndTimeRef.current = performance.now();

    // Calculate average velocity from recent samples
    const now = performance.now();
    const recentSamples = touchState.current.velocitySamples.filter(
      s => now - s.time < 100 // Only last 100ms
    );

    if (recentSamples.length >= 2) {
      // Simple average
      const avgVelocity = recentSamples.reduce((sum, s) => sum + s.velocity, 0) / recentSamples.length;

      // Start inertia if velocity is significant
      const MIN_VELOCITY = 0.1; // pixels/ms
      if (Math.abs(avgVelocity) > MIN_VELOCITY) {
        // Cap velocity
        const MAX_VELOCITY = 2.0;
        const clampedVelocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, avgVelocity));

        startInertia(clampedVelocity);
        touchState.current.isActive = false;
        return;
      }
    }

    // No inertia - commit position immediately
    touchState.current.isActive = false;
    setScrollPosition(scrollOffsetRef.current);

    // Reset click prevention after delay
    setTimeout(() => {
      preventClickRef.current = false;
    }, 300);
  }, [layoutMode, startInertia, isDragging, stopAutoScroll]);

  // TOUCH HANDLERS FOR WRAPPED MODE
  const handleWrappedTouchStart = useCallback((e) => {
    if (layoutMode !== 'wrapped') return;
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (touch.clientX - rect.left) * scaleX;
    const canvasY = (touch.clientY - rect.top) * scaleY;

    selectionTouchRef.current = {
      isSelecting: false,
      startX: touch.clientX,
      startY: touch.clientY,
      identifier: touch.identifier,
      canvasX,
      canvasY
    };

    // Start a timeout for long press detection (500ms)
    const longPressTimeout = setTimeout(() => {
      const position = getBasePositionFromCanvas(canvasX, canvasY);

      if (position !== null) {
        selectionTouchRef.current.isSelecting = true;
        setIsDragging(true);
        setDragStartPosition(position);
        selectionRangeRef.current = null;
        setSelectionRange(null);

        // Provide haptic feedback if available
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }
    }, 500);

    selectionTouchRef.current.timeoutId = longPressTimeout;
  }, [layoutMode, getBasePositionFromCanvas]);

  const handleWrappedTouchMove = useCallback((e) => {
    if (layoutMode !== 'wrapped') return;
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];

    // Cancel long-press if moved before timeout
    if (!selectionTouchRef.current.isSelecting && selectionTouchRef.current.timeoutId) {
      const dx = Math.abs(touch.clientX - selectionTouchRef.current.startX);
      const dy = Math.abs(touch.clientY - selectionTouchRef.current.startY);

      if (dx > 10 || dy > 10) {
        clearTimeout(selectionTouchRef.current.timeoutId);
        selectionTouchRef.current.timeoutId = null;
        return; // Let native scroll happen
      }
    }

    // If selecting, update selection and check for auto-scroll
    if (selectionTouchRef.current.isSelecting && isDragging) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = (touch.clientX - rect.left) * scaleX;
      const canvasY = (touch.clientY - rect.top) * scaleY;

      // Check if touch is near top/bottom edge of VIEWPORT for auto-scroll
      const edgeThreshold = 50; // pixels from edge
      const container = canvas.parentElement;

      if (container) {
        const containerRect = container.getBoundingClientRect();
        // Calculate touch position relative to the viewport container
        const touchViewportY = touch.clientY - containerRect.top;

        if (touchViewportY < edgeThreshold && container.scrollTop > 0) {
          // Near top of viewport - scroll up
          startAutoScroll(-1, 'wrapped');
        } else if (touchViewportY > containerRect.height - edgeThreshold &&
                   container.scrollTop < container.scrollHeight - container.clientHeight) {
          // Near bottom of viewport - scroll down
          startAutoScroll(1, 'wrapped');
        } else {
          // Not near edge - stop auto-scroll
          stopAutoScroll();
        }
      }

      const currentPosition = getBasePositionFromCanvas(canvasX, canvasY);

      if (currentPosition !== null && dragStartPosition !== null) {
        const start = Math.min(dragStartPosition, currentPosition);
        const end = Math.max(dragStartPosition, currentPosition);
        const newRange = { start, end };

        // Update both state and ref (ref is used for immediate drawing)
        selectionRangeRef.current = newRange;
        setSelectionRange(newRange);

        // Manually redraw to show updated selection
        drawChromatogram();
      }

      e.preventDefault();
      e.stopPropagation();
    }
  }, [layoutMode, isDragging, dragStartPosition, getBasePositionFromCanvas, startAutoScroll, stopAutoScroll]);

  const handleWrappedTouchEnd = useCallback((e) => {
    if (layoutMode !== 'wrapped') return;

    // Clear long-press timer if it exists
    if (selectionTouchRef.current.timeoutId) {
      clearTimeout(selectionTouchRef.current.timeoutId);
      selectionTouchRef.current.timeoutId = null;
    }

    // If we were selecting, finalize the selection
    if (selectionTouchRef.current.isSelecting && isDragging) {
      stopAutoScroll(); // Stop any auto-scrolling
      setIsDragging(false);
      setDragStartPosition(null);
      selectionTouchRef.current.isSelecting = false;
    }
  }, [layoutMode, isDragging, stopAutoScroll]);

  // Add touch scrolling to canvas (only in horizontal mode)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !parsedData) return;

    // Only add touch handlers in horizontal mode
    // In wrapped mode, use native browser scrolling
    if (layoutMode !== 'horizontal') return;

    canvas.addEventListener('touchstart', handleCanvasTouchStart);
    canvas.addEventListener('touchmove', handleCanvasTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleCanvasTouchEnd);

    return () => {
      canvas.removeEventListener('touchstart', handleCanvasTouchStart);
      canvas.removeEventListener('touchmove', handleCanvasTouchMove);
      canvas.removeEventListener('touchend', handleCanvasTouchEnd);
    };
  }, [parsedData, layoutMode, handleCanvasTouchStart, handleCanvasTouchMove, handleCanvasTouchEnd]);

  // Add touch handlers for wrapped mode (for selection only)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !parsedData) return;

    // Only add touch handlers in wrapped mode
    if (layoutMode !== 'wrapped') return;

    canvas.addEventListener('touchstart', handleWrappedTouchStart);
    canvas.addEventListener('touchmove', handleWrappedTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleWrappedTouchEnd);

    return () => {
      canvas.removeEventListener('touchstart', handleWrappedTouchStart);
      canvas.removeEventListener('touchmove', handleWrappedTouchMove);
      canvas.removeEventListener('touchend', handleWrappedTouchEnd);
    };
  }, [parsedData, layoutMode, handleWrappedTouchStart, handleWrappedTouchMove, handleWrappedTouchEnd]);

  // Cleanup inertia animation on component unmount
  useEffect(() => {
    return () => {
      if (inertiaState.current.rafId !== null) {
        cancelAnimationFrame(inertiaState.current.rafId);
      }
    };
  }, []);

  const handleSaveEdit = () => {
    if (!editValue || selectedPosition === null) return;

    // Create a new copy of the baseCalls array with the edit
    const newBaseCalls = [...parsedData.baseCalls];
    newBaseCalls[selectedPosition] = editValue;

    // Update the parsedData with the new base calls
    const newParsedData = {
      ...parsedData,
      baseCalls: newBaseCalls,
      sequence: newBaseCalls.join('') // Update the sequence string too
    };

    // Track that this position was edited
    setEditedPositions(prev => new Set([...prev, selectedPosition]));

    setParsedData(newParsedData);

    // Update the selected nucleotide display
    setSelectedNucleotide(editValue);

    // Exit editing mode
    setIsEditing(false);
    setEditValue('');

    console.log(`Edited position ${selectedPosition + 1} from ${selectedNucleotide} to ${editValue}`);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue('');
  };

  // IUPAC nucleotide code matching
  const matchIUPAC = (pattern, base) => {
    const iupacCodes = {
      'A': ['A'],
      'T': ['T'],
      'G': ['G'],
      'C': ['C'],
      'N': ['A', 'T', 'G', 'C'], // Any base
      'R': ['A', 'G'],            // Purine
      'Y': ['C', 'T'],            // Pyrimidine
      'W': ['A', 'T'],            // Weak
      'S': ['G', 'C'],            // Strong
      'M': ['A', 'C'],            // Amino
      'K': ['G', 'T'],            // Keto
      'B': ['C', 'G', 'T'],       // Not A
      'D': ['A', 'G', 'T'],       // Not C
      'H': ['A', 'C', 'T'],       // Not G
      'V': ['A', 'C', 'G']        // Not T
    };

    const allowedBases = iupacCodes[pattern] || [pattern];
    return allowedBases.includes(base);
  };

  // Check if a sequence matches a pattern with IUPAC codes
  const matchesPattern = (sequence, pattern) => {
    if (sequence.length !== pattern.length) return false;

    for (let i = 0; i < pattern.length; i++) {
      if (!matchIUPAC(pattern[i], sequence[i])) {
        return false;
      }
    }
    return true;
  };

  // Search for restriction enzyme sites in the sequence
  const findRestrictionSites = useCallback((sequence, enzymes) => {
    if (!sequence || !enzymes || enzymes.length === 0) {
      return [];
    }

    const sites = [];
    const upperSequence = sequence.toUpperCase();

    enzymes.forEach(enzyme => {
      const site = enzyme.site.toUpperCase();
      const siteLength = site.length;

      // Search for the recognition site in the sequence (handles degenerate bases)
      for (let i = 0; i <= upperSequence.length - siteLength; i++) {
        const subseq = upperSequence.substring(i, i + siteLength);
        if (matchesPattern(subseq, site)) {
          sites.push({
            enzyme: enzyme.name,
            position: i,
            cutPosition: i + enzyme.cut,
            site: subseq, // Store the actual matched sequence
            pattern: site, // Store the pattern
            type: enzyme.type
          });
        }
      }
    });

    // Sort by position
    sites.sort((a, b) => a.position - b.position);
    return sites;
  }, []);

  // Effect to search for restriction sites when sequence or selected enzymes change
  useEffect(() => {
    if (parsedData && parsedData.sequence && selectedEnzymes.length > 0) {
      const enzymes = restrictionEnzymes.filter(e => selectedEnzymes.includes(e.name));
      // Use the currently displayed sequence (forward or reverse complement)
      const displayData = showReverseComplement ? getReverseComplementData(parsedData) : parsedData;
      const sites = findRestrictionSites(displayData.sequence, enzymes);
      setRestrictionSites(sites);
    } else {
      setRestrictionSites([]);
    }
  }, [parsedData, selectedEnzymes, findRestrictionSites, showReverseComplement]);

  const parseChromatogramFile = async (data) => {
    try {
      setLoading(true);
      console.log('parseChromatogramFile called with data:', data, 'fileName:', fileName);

      let parsedData;

      // Check if we have real binary data or mock indicator
      if (data === 'mock' || !data || data.length < 100) {
        console.log('No real file data available');
        setError('Could not load chromatogram data');
        setLoading(false);
        return;
      } else {
        console.log('Parsing real file data, size:', data.length, 'bytes');
        try {
          // Detect file type
          const fileType = detectFileType(data);
          console.log('Detected file type:', fileType);

          if (fileType === 'SCF') {
            parsedData = parseRealSCFData(data, fileName);
          } else if (fileType === 'AB1') {
            parsedData = parseRealAB1Data(data, fileName);
          } else if (fileType === 'ZTR') {
            setError('ZTR_FORMAT');
            setLoading(false);
            return;
          } else {
            throw new Error('Unsupported file format - not AB1 or SCF');
          }
        } catch (parseError) {
          console.error('Failed to parse file data:', parseError);
          setError('Could not load chromatogram data');
          setLoading(false);
          return;
        }
      }

      setParsedData(parsedData);
      setLoading(false);
    } catch (err) {
      console.error('Error in parseChromatogramFile:', err);
      setError('Could not load chromatogram data');
      setLoading(false);
    }
  };

  // File type detection function
  const detectFileType = (uint8Array) => {
    if (uint8Array.length < 8) {
      throw new Error('File too small to determine type');
    }

    // Check for SCF magic bytes: 2E 73 63 66 (.scf in ASCII)
    if (uint8Array[0] === 0x2E && uint8Array[1] === 0x73 &&
      uint8Array[2] === 0x63 && uint8Array[3] === 0x66) {
      return 'SCF';
    }

    // Check for AB1 magic bytes: ABIF
    const signature = new TextDecoder().decode(uint8Array.slice(0, 4));
    if (signature === 'ABIF') {
      return 'AB1';
    }

    // Check for ZTR magic bytes: AE 5A 54 52 0D 0A 1A 0A (®ZTR\r\n\032\n)
    if (uint8Array[0] === 0xAE && uint8Array[1] === 0x5A &&
        uint8Array[2] === 0x54 && uint8Array[3] === 0x52 &&
        uint8Array[4] === 0x0D && uint8Array[5] === 0x0A &&
        uint8Array[6] === 0x1A && uint8Array[7] === 0x0A) {
      return 'ZTR';
    }

    throw new Error('Unknown file format - not AB1, SCF, or ZTR');
  };

  // Parse SCF binary data
  const parseRealSCFData = (uint8Array, fileName) => {
    // SCF files start with ".scf" signature (2E 73 63 66)
    if (uint8Array[0] !== 0x2E || uint8Array[1] !== 0x73 ||
      uint8Array[2] !== 0x63 || uint8Array[3] !== 0x66) {
      throw new Error('Not a valid SCF file - missing .scf signature');
    }

    // Create DataView for reading binary data
    const dataView = new DataView(uint8Array.buffer);

    // SCF header structure (starting at byte 0)
    const magic = dataView.getUint32(0, false); // Should be 0x2E736366 (.scf)
    const samples = dataView.getUint32(4, false); // Number of sample points
    const samplesOffset = dataView.getUint32(8, false); // Offset to sample data
    const bases = dataView.getUint32(12, false); // Number of bases
    const basesLeftClip = dataView.getUint32(16, false); // Left clip point
    const basesRightClip = dataView.getUint32(20, false); // Right clip point  
    const basesOffset = dataView.getUint32(24, false); // Offset to base data
    const version = new TextDecoder().decode(uint8Array.slice(36, 40)); // Version string
    const sampleSize = dataView.getUint32(40, false); // Sample size (1 or 2 bytes)

    // Validate header values
    if (samples === 0 || bases === 0) {
      throw new Error('Invalid SCF file - no samples or bases found');
    }

    // Read trace data (samples)
    const traces = { A: [], T: [], G: [], C: [] };
    const channels = ['A', 'C', 'G', 'T']; // SCF standard order

    // SCF 3.x uses delta-delta encoding for trace data
    // Per spec: values are stored as UNSIGNED, then decoded with TWO integration passes

    // SCF stores 4 channels of sample data
    for (let channel = 0; channel < 4; channel++) {
      const channelName = channels[channel];
      const channelOffset = samplesOffset + (channel * samples * sampleSize);

      // Read all values as UNSIGNED (per SCF spec)
      for (let i = 0; i < samples; i++) {
        const sampleOffset = channelOffset + (i * sampleSize);
        let value;

        if (sampleSize === 1) {
          // 8-bit unsigned samples
          value = uint8Array[sampleOffset];
        } else if (sampleSize === 2) {
          // 16-bit unsigned samples (big-endian)
          value = dataView.getUint16(sampleOffset, false);
        } else {
          throw new Error(`Unsupported sample size: ${sampleSize}`);
        }

        traces[channelName].push(value);
      }

      // Apply delta-delta decoding: TWO integration passes per SCF spec with overflow
      traces[channelName] = deltaDeltaDecode(traces[channelName], sampleSize);
    }

    // Read base call data
    const baseCalls = [];
    const quality = [];
    const peakLocations = [];

    // SCF 3.00 stores base data in COLUMNAR format (transposed)
    // SCF 3.10+ stores as array of structs
    const versionNumber = parseFloat(version.replace(/\0/g, '').trim());
    const isColumnar = versionNumber < 3.1;

    if (isColumnar) {
      // SCF 3.00 columnar format: all peaks, all prob_A, all prob_C, all prob_G, all prob_T, all bases, spare
      const peakIndexOffset = basesOffset;
      const probAOffset = peakIndexOffset + (bases * 4);
      const probCOffset = probAOffset + bases;
      const probGOffset = probCOffset + bases;
      const probTOffset = probGOffset + bases;
      const basesCharOffset = probTOffset + bases;

      for (let i = 0; i < bases; i++) {
        // Read peak index (uint_4)
        const peakIndex = dataView.getUint32(peakIndexOffset + (i * 4), false);

        // Read probabilities
        const probA = uint8Array[probAOffset + i] || 0;
        const probC = uint8Array[probCOffset + i] || 0;
        const probG = uint8Array[probGOffset + i] || 0;
        const probT = uint8Array[probTOffset + i] || 0;

        // Read base character
        const baseChar = uint8Array[basesCharOffset + i];
        let baseCall = 'N';
        if (baseChar >= 65 && baseChar <= 90) {
          baseCall = String.fromCharCode(baseChar);
        } else if (baseChar >= 97 && baseChar <= 122) {
          baseCall = String.fromCharCode(baseChar).toUpperCase();
        } else if (baseChar === 0) {
          // Derive from probabilities if no base character
          const maxProb = Math.max(probA, probC, probG, probT);
          if (maxProb > 0) {
            if (probA === maxProb) baseCall = 'A';
            else if (probC === maxProb) baseCall = 'C';
            else if (probG === maxProb) baseCall = 'G';
            else if (probT === maxProb) baseCall = 'T';
          }
        }

        // Validate peak index
        if (peakIndex >= 0 && peakIndex < samples) {
          peakLocations.push(peakIndex);
        } else {
          peakLocations.push(Math.floor((i / bases) * samples));
        }

        baseCalls.push(baseCall);

        // Quality from max probability
        const maxProb = Math.max(probA, probC, probG, probT);
        quality.push(Math.min(60, maxProb));
      }
    } else {
      // SCF 3.10+ array of 16-byte structs

      for (let i = 0; i < bases; i++) {
        const baseOffset = basesOffset + (i * 16);

        const peakIndex = dataView.getUint32(baseOffset, false);
        const probA = uint8Array[baseOffset + 4] || 0;
        const probC = uint8Array[baseOffset + 5] || 0;
        const probG = uint8Array[baseOffset + 6] || 0;
        const probT = uint8Array[baseOffset + 7] || 0;
        const baseChar = uint8Array[baseOffset + 8];

        let baseCall = 'N';
        if (baseChar >= 65 && baseChar <= 90) {
          baseCall = String.fromCharCode(baseChar);
        } else if (baseChar >= 97 && baseChar <= 122) {
          baseCall = String.fromCharCode(baseChar).toUpperCase();
        } else {
          const maxProb = Math.max(probA, probC, probG, probT);
          if (maxProb > 0) {
            if (probA === maxProb) baseCall = 'A';
            else if (probC === maxProb) baseCall = 'C';
            else if (probG === maxProb) baseCall = 'G';
            else if (probT === maxProb) baseCall = 'T';
          }
        }

        if (peakIndex >= 0 && peakIndex < samples) {
          peakLocations.push(peakIndex);
        } else {
          peakLocations.push(Math.floor((i / bases) * samples));
        }

        baseCalls.push(baseCall);
        quality.push(Math.min(60, Math.max(probA, probC, probG, probT)));
      }
    }

    // Build sequence string  
    const sequence = baseCalls.join('');

    // Validate we have data
    if (Object.values(traces).every(trace => trace.length === 0)) {
      throw new Error('No trace data found in SCF file');
    }

    if (baseCalls.length === 0) {
      throw new Error('No base calls found in SCF file');
    }

    return {
      sequence,
      traces,
      quality,
      baseCalls,
      peakLocations,
      fileName: fileName || 'parsed.scf',
      sequenceLength: baseCalls.length,
      fileFormat: 'SCF'
    };
  };

  // Delta-delta decoding for SCF trace data
  // From SCF spec: apply integration TWICE with unsigned integer overflow
  const deltaDeltaDecode = (samples, sampleSize) => {
    if (samples.length === 0) return [];

    // Create a copy to avoid modifying the input
    const decoded = [...samples];

    // Determine the modulo for unsigned integer wrapping based on precision
    const mod = sampleSize === 1 ? 256 : 65536;  // uint8 or uint16

    // First integration pass with wrapping
    let p_sample = 0;
    for (let i = 0; i < decoded.length; i++) {
      decoded[i] = (decoded[i] + p_sample) % mod;
      p_sample = decoded[i];
    }

    // Second integration pass with wrapping
    p_sample = 0;
    for (let i = 0; i < decoded.length; i++) {
      decoded[i] = (decoded[i] + p_sample) % mod;
      p_sample = decoded[i];
    }

    return decoded;
  };

  // New function to parse real AB1 binary data
  const parseRealAB1Data = (uint8Array, fileName) => {
    console.log('Starting real AB1 parsing...');

    // AB1 files start with "ABIF" signature
    const signature = new TextDecoder().decode(uint8Array.slice(0, 4));
    if (signature !== 'ABIF') {
      throw new Error('Not a valid AB1 file - missing ABIF signature');
    }

    // Create DataView for reading binary data
    const dataView = new DataView(uint8Array.buffer);

    // Read the directory structure (starts at byte 26)
    const directoryOffset = dataView.getUint32(26, false); // big endian
    const numEntries = dataView.getUint32(18, false);

    console.log(`AB1 file has ${numEntries} directory entries at offset ${directoryOffset}`);

    // Parse directory entries to find data we need
    const entries = {};
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = directoryOffset + (i * 28);

      // Read entry header
      const name = new TextDecoder().decode(uint8Array.slice(entryOffset, entryOffset + 4));
      const number = dataView.getUint32(entryOffset + 4, false);
      const elementType = dataView.getUint16(entryOffset + 8, false);
      const elementSize = dataView.getUint16(entryOffset + 10, false);
      const numElements = dataView.getUint32(entryOffset + 12, false);
      const dataSize = dataView.getUint32(entryOffset + 16, false);
      const dataOffset = dataView.getUint32(entryOffset + 20, false);

      const key = `${name}${number}`;
      entries[key] = {
        name,
        number,
        elementType,
        elementSize,
        numElements,
        dataSize,
        dataOffset
      };
    }

    console.log('Found AB1 entries:', Object.keys(entries));

    // Extract trace data (DATA tags 9-12) and map to correct channels
    const traces = { A: [], T: [], G: [], C: [] };

    // Check if there's a channel order tag (FWO_1) to get the correct mapping
    let channelOrder = ['A', 'T', 'G', 'C']; // default order
    if (entries['FWO_1']) {
      const entry = entries['FWO_1'];
      const orderData = uint8Array.slice(entry.dataOffset, entry.dataOffset + entry.dataSize);
      channelOrder = Array.from(orderData).map(byte => String.fromCharCode(byte)).filter(char => /[ATGC]/.test(char));
      console.log('Found channel order:', channelOrder);
    }

    // If no FWO tag or it's incomplete, try common mappings
    if (channelOrder.length !== 4) {
      // ABI 3730/3130 common order is G,A,T,C for DATA9-12
      channelOrder = ['G', 'A', 'T', 'C'];
      console.log('Using default channel order:', channelOrder);
    }

    for (let i = 0; i < 4; i++) {
      const dataKey = `DATA${9 + i}`;
      if (entries[dataKey] && i < channelOrder.length) {
        const entry = entries[dataKey];
        const traceData = [];

        // Read trace values (usually 16-bit integers)
        for (let j = 0; j < entry.numElements; j++) {
          const offset = entry.dataOffset + (j * 2);
          if (offset + 1 < uint8Array.length) {
            const value = dataView.getUint16(offset, false);
            traceData.push(value);
          }
        }

        const channel = channelOrder[i];
        traces[channel] = traceData;
        console.log(`Loaded ${traceData.length} trace points for DATA${9 + i} -> channel ${channel}`);
      }
    }

    // Extract base calls (PBAS tag)
    let baseCalls = [];
    if (entries['PBAS1']) {
      const entry = entries['PBAS1'];
      const baseCallData = uint8Array.slice(entry.dataOffset, entry.dataOffset + entry.dataSize);
      baseCalls = Array.from(baseCallData).map(byte => String.fromCharCode(byte)).filter(char => /[ATGCN]/.test(char));
      console.log(`Loaded ${baseCalls.length} base calls`);
    }

    // Extract quality scores (PCON tag)
    let quality = [];
    if (entries['PCON1']) {
      const entry = entries['PCON1'];
      for (let i = 0; i < entry.numElements && i < baseCalls.length; i++) {
        const offset = entry.dataOffset + i;
        if (offset < uint8Array.length) {
          quality.push(uint8Array[offset]);
        }
      }
      console.log(`Loaded ${quality.length} quality scores`);
    }

    // If we don't have quality data, generate reasonable defaults
    if (quality.length === 0 && baseCalls.length > 0) {
      quality = baseCalls.map(() => Math.floor(Math.random() * 40) + 20);
      console.log('Generated default quality scores');
    }

    const maxTraceLength = Math.max(...Object.values(traces).map(t => t.length));

    // Extract peak locations (PLOC tag)
    let peakLocations = [];
    if (entries['PLOC1']) {
      const entry = entries['PLOC1'];
      for (let i = 0; i < entry.numElements && i < baseCalls.length; i++) {
        const offset = entry.dataOffset + (i * 2);
        if (offset + 1 < uint8Array.length) {
          const peakPos = dataView.getUint16(offset, false);
          peakLocations.push(peakPos);
        }
      }
      console.log(`Loaded ${peakLocations.length} peak locations`);
    }

    // If no peak locations found, calculate estimated positions
    if (peakLocations.length === 0 && baseCalls.length > 0) {
      const estimatedSpacing = maxTraceLength / baseCalls.length;
      peakLocations = baseCalls.map((_, i) => Math.round(i * estimatedSpacing));
      console.log('Generated estimated peak locations');
    }

    // Build sequence string
    const sequence = baseCalls.join('');

    // Validate we have data
    if (Object.values(traces).every(trace => trace.length === 0)) {
      throw new Error('No trace data found in AB1 file');
    }

    if (baseCalls.length === 0) {
      throw new Error('No base calls found in AB1 file');
    }

    console.log(`Successfully parsed AB1: ${sequence.length} bases, ${Math.max(...Object.values(traces).map(t => t.length))} trace points`);

    return {
      sequence,
      traces,
      quality,
      baseCalls,
      peakLocations,
      fileName: fileName || 'parsed.ab1',
      sequenceLength: baseCalls.length,
      fileFormat: 'AB1'
    };
  };


  // Smoothing function to reduce noise (enhanced)
  const smoothData = (data, windowSize = 7) => {
    const smoothed = [...data];
    const halfWindow = Math.floor(windowSize / 2);

    for (let i = halfWindow; i < data.length - halfWindow; i++) {
      let sum = 0;
      let weightSum = 0;

      // Apply Gaussian-like weighting for better smoothing
      for (let j = -halfWindow; j <= halfWindow; j++) {
        const weight = Math.exp(-(j * j) / (2 * (halfWindow / 2) * (halfWindow / 2)));
        sum += data[i + j] * weight;
        weightSum += weight;
      }
      smoothed[i] = sum / weightSum;
    }

    return smoothed;
  };

  // FIX: Helper function for consistent position calculation
  const getBaseXPosition = (baseIndex, startIndex, endIndex, canvasWidth) => {
    return ((baseIndex * 4 - startIndex) / (endIndex - startIndex)) * canvasWidth;
  };

  // Pre-render the full chromatogram to an offscreen canvas (for horizontal mode)
  const renderToOffscreenCanvas = useCallback(() => {
    if (!parsedData || layoutMode !== 'horizontal') return;

    const displayData = showReverseComplement ? getReverseComplementData(parsedData) : parsedData;
    const { traces, quality, baseCalls, peakLocations } = displayData;

    const traceLengths = Object.values(traces).map(trace => trace.length);
    const maxTraceLength = Math.max(...traceLengths);

    if (maxTraceLength === 0) return;

    // Get height from container, not from canvas element (which might not be sized yet)
    const canvas = canvasRef.current;
    if (!canvas) return;

    const container = canvas.parentElement;
    if (!container) return;

    // Force layout calculation
    void container.offsetHeight;
    const height = container.offsetHeight;

    // Don't render if container hasn't been sized yet
    if (height < 10) {
      console.log('Container not sized yet, deferring offscreen canvas creation');
      return;
    }

    // Create offscreen canvas with full width
    const fullWidth = Math.floor(maxTraceLength * zoomLevel);

    // Create or resize offscreen canvas
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }

    offscreenCanvasRef.current.width = fullWidth;
    offscreenCanvasRef.current.height = height;

    const offCtx = offscreenCanvasRef.current.getContext('2d', { willReadFrequently: false });
    if (!offCtx) return;

    // Clear offscreen canvas
    offCtx.fillStyle = '#ffffff';
    offCtx.fillRect(0, 0, fullWidth, height);

    // Find global max for normalization
    let maxValue = 0;
    Object.values(traces).forEach(trace => {
      for (let i = 0; i < trace.length; i++) {
        maxValue = Math.max(maxValue, trace[i]);
      }
    });
    if (maxValue === 0) maxValue = 1;

    // Draw traces
    const colors = {
      A: '#00AA00',
      T: '#FF0000',
      G: '#000000',
      C: '#0000FF'
    };

    const baseCallHeight = 30;
    const bottomReserve = 50;
    const traceHeight = Math.max(100, height - baseCallHeight - bottomReserve);
    const baselineY = baseCallHeight + traceHeight;

    Object.entries(traces).forEach(([base, data]) => {
      if (!showChannels[base] || data.length === 0) return;

      offCtx.strokeStyle = colors[base];
      offCtx.lineWidth = 2;
      offCtx.lineCap = 'round';
      offCtx.lineJoin = 'round';
      offCtx.beginPath();

      let pathStarted = false;
      for (let i = 0; i < data.length; i++) {
        const x = i * zoomLevel;
        const normalizedValue = (data[i] / maxValue) * traceHeight;
        const y = baselineY - normalizedValue;

        if (!pathStarted) {
          offCtx.moveTo(x, y);
          pathStarted = true;
        } else {
          offCtx.lineTo(x, y);
        }
      }
      offCtx.stroke();
    });

    // Draw base calls
    offCtx.font = 'bold 18px monospace';
    offCtx.textAlign = 'center';

    baseCalls.forEach((base, index) => {
      const peakPos = peakLocations && peakLocations[index] !== undefined
        ? peakLocations[index]
        : (index * maxTraceLength / baseCalls.length);
      const x = peakPos * zoomLevel;

      offCtx.fillStyle = colors[base] || '#000000';
      offCtx.fillText(base, x, 20);
    });

    // Draw quality scores (positioned below the baseline)
    if (quality && quality.length > 0) {
      const qualityBarMaxHeight = 25;
      const qualityBarStartY = baselineY + 5; // Start just below the baseline

      baseCalls.forEach((base, index) => {
        if (index >= quality.length) return;

        const q = quality[index];
        const peakPos = peakLocations && peakLocations[index] !== undefined
          ? peakLocations[index]
          : (index * maxTraceLength / baseCalls.length);
        const x = peakPos * zoomLevel;

        let barColor;
        if (q >= 40) barColor = '#00AA00';
        else if (q >= 20) barColor = '#FFA500';
        else barColor = '#FF0000';

        offCtx.fillStyle = barColor;
        const barHeight = (q / 60) * qualityBarMaxHeight;
        offCtx.fillRect(x - 2, qualityBarStartY, 4, barHeight);
      });
    }

    // Draw position markers
    offCtx.fillStyle = '#666666';
    offCtx.font = '10px sans-serif';
    offCtx.textAlign = 'center';

    const markerInterval = Math.max(10, Math.floor(50 / zoomLevel));
    for (let i = 0; i < baseCalls.length; i += markerInterval) {
      const peakPos = peakLocations && peakLocations[i] !== undefined
        ? peakLocations[i]
        : (i * maxTraceLength / baseCalls.length);
      const x = peakPos * zoomLevel;

      offCtx.fillRect(x, height - 35, 1, 5);
      offCtx.fillText(String(i + 1), x, height - 5);
    }

    // Draw ORFs (these don't change during scrolling)
    if (showORFs && detectedORFs.length > 0) {
      const orfHeight = 14;
      const orfYOffset = 35;

      detectedORFs.forEach((orf) => {
        const startPeakPosition = peakLocations && peakLocations[orf.start]
          ? peakLocations[orf.start]
          : (orf.start * maxTraceLength / baseCalls.length);
        const endPeakPosition = peakLocations && peakLocations[orf.end]
          ? peakLocations[orf.end]
          : (orf.end * maxTraceLength / baseCalls.length);

        const startX = startPeakPosition * zoomLevel;
        const endX = endPeakPosition * zoomLevel;

        const frameIndex = ['+1', '+2', '+3', '-1', '-2', '-3'].indexOf(orf.frame);
        const yPos = orfYOffset + (frameIndex * (orfHeight + 2));

        const isForward = orf.strand === '+';
        const orfColors = isForward
          ? ['#3B82F6', '#60A5FA', '#93C5FD']
          : ['#F97316', '#FB923C', '#FDBA74'];
        const colorIndex = isForward ? frameIndex : frameIndex - 3;

        offCtx.fillStyle = orfColors[colorIndex];
        offCtx.fillRect(startX, yPos, endX - startX, orfHeight);

        // Draw amino acids inside the ORF box
        if (orf.aminoAcids) {
          offCtx.font = 'bold 10px monospace';
          offCtx.fillStyle = '#FFFFFF';
          offCtx.textAlign = 'center';
          offCtx.textBaseline = 'middle';

          // Draw each amino acid at the position of the middle base of its codon
          for (let i = 0; i < orf.aminoAcids.length; i++) {
            const codonStartPos = orf.start + (i * 3);
            const middleBasePos = codonStartPos + 1;

            const middlePeakPosition = peakLocations && peakLocations[middleBasePos]
              ? peakLocations[middleBasePos]
              : (middleBasePos * maxTraceLength / baseCalls.length);

            const x = middlePeakPosition * zoomLevel;
            offCtx.fillText(orf.aminoAcids[i], x, yPos + orfHeight / 2);
          }
        }
      });
    }

    // Draw RE sites (these don't change during scrolling)
    if (showRestrictionSites && restrictionSites.length > 0) {
      restrictionSites.forEach(site => {
        const peakPos = peakLocations && peakLocations[site.position]
          ? peakLocations[site.position]
          : (site.position * maxTraceLength / baseCalls.length);
        const x = peakPos * zoomLevel;

        offCtx.strokeStyle = '#9333EA';
        offCtx.lineWidth = 2;
        offCtx.setLineDash([4, 4]);
        offCtx.beginPath();
        offCtx.moveTo(x, 30);
        offCtx.lineTo(x, height - 35);
        offCtx.stroke();
        offCtx.setLineDash([]);

        offCtx.fillStyle = '#9333EA';
        offCtx.font = 'bold 14px "Courier New", monospace';
        offCtx.textAlign = 'left';
        offCtx.fillText(site.enzyme, x + 4, 42);
      });
    }

    console.log('Offscreen canvas rendered:', fullWidth, 'x', height, '| baselineY:', baselineY, '| traceHeight:', traceHeight);
  }, [parsedData, zoomLevel, showChannels, showReverseComplement, layoutMode, showORFs, detectedORFs, showRestrictionSites, restrictionSites]);

  // Re-render offscreen canvas when relevant data changes
  useEffect(() => {
    if (layoutMode === 'horizontal' && parsedData) {
      renderToOffscreenCanvas();
    } else if (offscreenCanvasRef.current) {
      // Clear offscreen canvas when not in horizontal mode to save memory
      offscreenCanvasRef.current = null;
    }
  }, [parsedData, zoomLevel, showChannels, showReverseComplement, layoutMode, showORFs, detectedORFs, showRestrictionSites, restrictionSites, renderToOffscreenCanvas]);

  const drawChromatogram = () => {
    const canvas = canvasRef.current;
    if (!canvas || !parsedData) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: false });

    // Validate context (important for mobile WebView)
    if (!ctx) {
      console.warn('Canvas context not available, retrying...');
      requestAnimationFrame(() => drawChromatogram());
      return;
    }

    // Use reverse complement data if toggle is enabled
    const displayData = showReverseComplement ? getReverseComplementData(parsedData) : parsedData;
    const { traces, quality, baseCalls, peakLocations } = displayData;

    // Validate trace data
    const traceLengths = Object.values(traces).map(trace => trace.length);
    const maxTraceLength = Math.max(...traceLengths);

    if (maxTraceLength === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#FF0000';
      ctx.font = '16px sans-serif';
      ctx.fillText('No trace data available', 50, 50);
      return;
    }

    // Set canvas size dynamically based on container
    const container = canvas.parentElement;
    if (container) {
      // Force layout recalculation (important for mobile WebView)
      void container.offsetHeight;
      canvas.width = container.offsetWidth || 1200;

      if (layoutMode === 'wrapped') {
        // In wrapped mode, calculate height based on number of rows needed
        const traceLengths = Object.values(traces).map(trace => trace.length);
        const maxTraceLength = Math.max(...traceLengths);
        const tracePointsPerRow = Math.floor(canvas.width / zoomLevel);
        const numRows = Math.ceil(maxTraceLength / tracePointsPerRow);
        const rowHeight = 200; // Height per row
        canvas.height = numRows * rowHeight;
      } else {
        canvas.height = container.offsetHeight || 300;
      }
    } else {
      // Fallback to larger default sizes
      canvas.width = 1600;
      canvas.height = 300;
    }

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (layoutMode === 'wrapped') {
      // Wrapped layout: draw multiple rows
      drawWrappedLayout(ctx, traces, quality, baseCalls, maxTraceLength, peakLocations);
    } else {
      // Horizontal scrolling layout: draw single row
      drawHorizontalLayout(ctx, traces, quality, baseCalls, maxTraceLength, peakLocations);
    }
  };

  const drawHorizontalLayout = (ctx, traces, quality, baseCalls, maxTraceLength, peakLocations) => {
    const canvas = canvasRef.current;

    // Calculate visible range
    // Use scrollOffsetRef during touch/inertia, otherwise use React state
    const currentScrollPos = (touchState.current.isActive || inertiaState.current.isActive)
      ? scrollOffsetRef.current
      : scrollPosition;
    const dataLength = maxTraceLength;
    const visiblePoints = Math.floor(canvas.width / zoomLevel);
    const startIndex = Math.floor(currentScrollPos * (dataLength - visiblePoints));
    const endIndex = Math.min(startIndex + visiblePoints, dataLength);

    // Check if offscreen canvas needs regeneration (height mismatch or doesn't exist)
    const needsRegeneration = !offscreenCanvasRef.current ||
                              offscreenCanvasRef.current.width === 0 ||
                              offscreenCanvasRef.current.height !== canvas.height;

    // If we have a pre-rendered offscreen canvas with matching dimensions, just copy the visible portion
    if (!needsRegeneration && offscreenCanvasRef.current) {
      const sourceX = startIndex * zoomLevel;
      const sourceWidth = canvas.width;
      const sourceHeight = canvas.height;

      // Copy visible portion from offscreen canvas
      ctx.drawImage(
        offscreenCanvasRef.current,
        sourceX, 0, // source x, y
        sourceWidth, sourceHeight, // source width, height
        0, 0, // dest x, y
        canvas.width, canvas.height // dest width, height
      );

      // Draw dynamic overlays on top (these change based on interaction)
      drawHorizontalOverlays(ctx, baseCalls, maxTraceLength, peakLocations, startIndex, endIndex);
      return;
    }

    // Need to regenerate offscreen canvas (e.g., after layout switch)
    if (needsRegeneration) {
      renderToOffscreenCanvas();
      // If offscreen canvas is now ready, use it
      if (offscreenCanvasRef.current && offscreenCanvasRef.current.width > 0) {
        const sourceX = startIndex * zoomLevel;
        ctx.drawImage(
          offscreenCanvasRef.current,
          sourceX, 0,
          canvas.width, canvas.height,
          0, 0,
          canvas.width, canvas.height
        );
        drawHorizontalOverlays(ctx, baseCalls, maxTraceLength, peakLocations, startIndex, endIndex);
        return;
      }
    }

    // Fallback: if offscreen canvas still not ready, do full render (should rarely happen)
    renderHorizontalFull(ctx, traces, quality, baseCalls, maxTraceLength, peakLocations, startIndex, endIndex);
    drawHorizontalOverlays(ctx, baseCalls, maxTraceLength, peakLocations, startIndex, endIndex);
  };

  // Render full chromatogram (fallback when offscreen canvas not available)
  const renderHorizontalFull = (ctx, traces, quality, baseCalls, maxTraceLength, peakLocations, startIndex, endIndex) => {
    const canvas = canvasRef.current;

    // Find the maximum value in the visible range for normalization
    let maxValue = 0;
    Object.values(traces).forEach(trace => {
      for (let i = startIndex; i < endIndex && i < trace.length; i++) {
        maxValue = Math.max(maxValue, trace[i]);
      }
    });
    if (maxValue === 0) maxValue = 1;

    const colors = {
      A: '#00AA00',
      T: '#FF0000',
      G: '#000000',
      C: '#0000FF'
    };

    const baseCallHeight = 30;
    const bottomReserve = 50;
    const traceHeight = Math.max(100, canvas.height - baseCallHeight - bottomReserve);
    const baselineY = baseCallHeight + traceHeight;

    // Draw traces
    Object.entries(traces).forEach(([base, data]) => {
      if (!showChannels[base] || data.length === 0) return;

      ctx.strokeStyle = colors[base];
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();

      let pathStarted = false;
      for (let i = startIndex; i < endIndex && i < data.length; i++) {
        const x = ((i - startIndex) / (endIndex - startIndex)) * canvas.width;
        const normalizedValue = (data[i] / maxValue) * traceHeight;
        const y = baselineY - normalizedValue;

        if (!pathStarted) {
          ctx.moveTo(x, y);
          pathStarted = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    });

    // Draw base calls and quality
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';

    baseCalls.forEach((base, index) => {
      const peakPos = peakLocations && peakLocations[index] !== undefined
        ? peakLocations[index]
        : (index * maxTraceLength / baseCalls.length);

      if (peakPos < startIndex || peakPos > endIndex) return;
      const x = ((peakPos - startIndex) / (endIndex - startIndex)) * canvas.width;

      ctx.fillStyle = colors[base] || '#000000';
      ctx.fillText(base, x, 20);

      // Quality bar (draw below the baseline)
      if (quality && quality[index] !== undefined) {
        const q = quality[index];
        let barColor;
        if (q >= 40) barColor = '#00AA00';
        else if (q >= 20) barColor = '#FFA500';
        else barColor = '#FF0000';

        ctx.fillStyle = barColor;
        const barHeight = (q / 60) * 25;
        ctx.fillRect(x - 2, baselineY + 5, 4, barHeight);
      }
    });

    // Draw position markers
    ctx.fillStyle = '#666666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';

    const markerInterval = Math.max(10, Math.floor(50 / zoomLevel));
    for (let i = 0; i < baseCalls.length; i += markerInterval) {
      const peakPos = peakLocations && peakLocations[i] !== undefined
        ? peakLocations[i]
        : (i * maxTraceLength / baseCalls.length);

      if (peakPos < startIndex || peakPos > endIndex) continue;
      const x = ((peakPos - startIndex) / (endIndex - startIndex)) * canvas.width;

      ctx.fillRect(x, canvas.height - 35, 1, 5);
      ctx.fillText(String(i + 1), x, canvas.height - 5);
    }
  };

  // Separated overlay rendering for interactive elements only (drawn on top of offscreen canvas copy)
  const drawHorizontalOverlays = (ctx, baseCalls, maxTraceLength, peakLocations, startIndex, endIndex) => {
    const canvas = canvasRef.current;

    const baseCallHeight = 30;
    const bottomReserve = 50;
    const traceHeight = Math.max(100, canvas.height - baseCallHeight - bottomReserve);
    const baselineY = baseCallHeight + traceHeight;

    // Helper to convert trace position to screen X
    const traceToScreenX = (tracePos) => {
      return ((tracePos - startIndex) / (endIndex - startIndex)) * canvas.width;
    };

    // Draw selected ORF highlight border (on top of pre-rendered ORFs)
    if (showORFs && selectedORF !== null && detectedORFs[selectedORF]) {
      const orf = detectedORFs[selectedORF];
      const orfHeight = 14;
      const orfYOffset = 35;

      const startPeakPosition = peakLocations && peakLocations[orf.start]
        ? peakLocations[orf.start]
        : (orf.start * maxTraceLength / baseCalls.length);
      const endPeakPosition = peakLocations && peakLocations[orf.end]
        ? peakLocations[orf.end]
        : (orf.end * maxTraceLength / baseCalls.length);

      if (endPeakPosition >= startIndex && startPeakPosition <= endIndex) {
        const startX = Math.max(0, traceToScreenX(startPeakPosition));
        const endX = Math.min(canvas.width, traceToScreenX(endPeakPosition));

        const frameIndex = ['+1', '+2', '+3', '-1', '-2', '-3'].indexOf(orf.frame);
        const yPos = orfYOffset + (frameIndex * (orfHeight + 2));

        // Draw thick border for selected ORF
        ctx.strokeStyle = '#312E81';
        ctx.lineWidth = 3;
        ctx.strokeRect(startX, yPos, endX - startX, orfHeight);

        // Add semi-transparent overlay
        ctx.fillStyle = 'rgba(79, 70, 229, 0.3)';
        ctx.fillRect(startX, yPos, endX - startX, orfHeight);
      }
    }

    // Draw selection range highlight for BLAST
    // Use ref for immediate updates during dragging
    const currentSelection = selectionRangeRef.current || selectionRange;
    if (currentSelection !== null) {
      const { start, end } = currentSelection;

      const startPeakPosition = peakLocations && peakLocations[start]
        ? peakLocations[start]
        : (start * maxTraceLength / baseCalls.length);
      const endPeakPosition = peakLocations && peakLocations[end]
        ? peakLocations[end]
        : (end * maxTraceLength / baseCalls.length);

      if (endPeakPosition >= startIndex && startPeakPosition <= endIndex) {
        // Add padding to encompass the entire base letter (12px on each side)
        const basePadding = 12;
        const startX = Math.max(0, traceToScreenX(startPeakPosition) - basePadding);
        const endX = Math.min(canvas.width, traceToScreenX(endPeakPosition) + basePadding);

        // Semi-transparent blue overlay
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.fillRect(startX, 0, endX - startX, canvas.height);

        // Border
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(startX, 0, endX - startX, canvas.height);
        ctx.setLineDash([]);
      }
    }

    // Draw hover highlight (for bases)
    if (hoveredPosition !== null && hoveredPosition !== selectedPosition) {
      const peakPosition = peakLocations && peakLocations[hoveredPosition]
        ? peakLocations[hoveredPosition]
        : (hoveredPosition * maxTraceLength / baseCalls.length);

      if (peakPosition >= startIndex && peakPosition <= endIndex) {
        const hoverX = traceToScreenX(peakPosition);
        if (hoverX >= 0 && hoverX <= canvas.width) {
          ctx.fillStyle = 'rgba(173, 216, 230, 0.4)';
          ctx.fillRect(hoverX - 12, 5, 24, baselineY + 20 - 5);

          // Redraw the base letter on top of the hover highlight
          const hoveredBase = baseCalls[hoveredPosition];
          const colors = {
            A: '#00AA00',
            T: '#FF0000',
            G: '#000000',
            C: '#0000FF'
          };
          ctx.font = 'bold 18px monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = colors[hoveredBase] || '#000000';
          ctx.fillText(hoveredBase, hoverX, 20);
        }
      }
    }

    // Draw selected position highlight
    if (selectedPosition !== null) {
      const peakPosition = peakLocations && peakLocations[selectedPosition]
        ? peakLocations[selectedPosition]
        : (selectedPosition * maxTraceLength / baseCalls.length);

      if (peakPosition >= startIndex && peakPosition <= endIndex) {
        const selectedX = traceToScreenX(peakPosition);
        if (selectedX >= 0 && selectedX <= canvas.width) {
          // Highlight box
          ctx.fillStyle = '#FFD700';
          ctx.fillRect(selectedX - 12, 5, 24, baseCallHeight - 5);
          ctx.strokeStyle = '#FF6600';
          ctx.lineWidth = 2;
          ctx.strokeRect(selectedX - 12, 5, 24, baseCallHeight - 5);

          // CRITICAL: Redraw the base letter on top of the highlight
          const selectedBase = baseCalls[selectedPosition];
          const colors = {
            A: '#00AA00',
            T: '#FF0000',
            G: '#000000',
            C: '#0000FF'
          };
          ctx.font = 'bold 18px monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = colors[selectedBase] || '#000000';
          ctx.fillText(selectedBase, selectedX, 20);

          // Vertical line through trace
          ctx.strokeStyle = '#FF6600';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(selectedX, baseCallHeight);
          ctx.lineTo(selectedX, baselineY + 20);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Draw search match highlights
    if (searchMatches.length > 0 && currentMatchIndex >= 0 && currentMatchIndex < searchMatches.length) {
      const match = searchMatches[currentMatchIndex];
      const startPeakPosition = peakLocations && peakLocations[match.start]
        ? peakLocations[match.start]
        : (match.start * maxTraceLength / baseCalls.length);
      const endPeakPosition = peakLocations && peakLocations[match.end]
        ? peakLocations[match.end]
        : (match.end * maxTraceLength / baseCalls.length);

      if (endPeakPosition >= startIndex && startPeakPosition <= endIndex) {
        const startX = Math.max(0, traceToScreenX(startPeakPosition));
        const endX = Math.min(canvas.width, traceToScreenX(endPeakPosition));

        ctx.fillStyle = 'rgba(255, 255, 0, 0.3)';
        ctx.fillRect(startX - 12, 5, (endX - startX) + 24, baselineY + 20 - 5);
        ctx.strokeStyle = '#FFAA00';
        ctx.lineWidth = 2;
        ctx.strokeRect(startX - 12, 5, (endX - startX) + 24, baselineY + 20 - 5);

        // Redraw base letters in the search match region
        const colors = {
          A: '#00AA00',
          T: '#FF0000',
          G: '#000000',
          C: '#0000FF'
        };
        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'center';

        for (let i = match.start; i <= match.end && i < baseCalls.length; i++) {
          const peakPos = peakLocations && peakLocations[i] !== undefined
            ? peakLocations[i]
            : (i * maxTraceLength / baseCalls.length);

          if (peakPos >= startIndex && peakPos <= endIndex) {
            const x = traceToScreenX(peakPos);
            ctx.fillStyle = colors[baseCalls[i]] || '#000000';
            ctx.fillText(baseCalls[i], x, 20);
          }
        }
      }
    }
  };

  const drawWrappedLayout = (ctx, traces, quality, baseCalls, maxTraceLength, peakLocations) => {
    const canvas = canvasRef.current;

    // Calculate trace points per row based on canvas width and zoom
    const tracePointsPerRow = Math.floor(canvas.width / zoomLevel);
    const numRows = Math.ceil(maxTraceLength / tracePointsPerRow);
    const rowHeight = 200;

    // Draw chromatogram traces with normalization
    const colors = {
      A: '#00AA00', // Green
      T: '#FF0000', // Red
      G: '#000000', // Black
      C: '#0000FF'  // Blue
    };

    // Layout constants per row
    const baseCallHeight = 30;
    const bottomReserve = 50;
    const traceHeight = rowHeight - baseCallHeight - bottomReserve;

    // Draw each row
    for (let row = 0; row < numRows; row++) {
      const rowY = row * rowHeight;

      // Calculate the trace data range for this row
      const startTraceIndex = row * tracePointsPerRow;
      const endTraceIndex = Math.min(startTraceIndex + tracePointsPerRow, maxTraceLength);

      // Find which bases have peaks in this trace range
      let startBase = -1;
      let endBase = -1;
      for (let i = 0; i < baseCalls.length; i++) {
        const peakPosition = peakLocations && peakLocations[i]
          ? peakLocations[i]
          : (i * maxTraceLength / baseCalls.length);

        if (peakPosition >= startTraceIndex && peakPosition < endTraceIndex) {
          if (startBase === -1) startBase = i;
          endBase = i + 1;
        } else if (startBase !== -1) {
          // We've passed the range
          break;
        }
      }

      // Skip this row if no bases found
      if (startBase === -1) continue;

      // Find max value in this row for normalization
      let maxValue = 0;
      Object.values(traces).forEach(trace => {
        for (let i = startTraceIndex; i < endTraceIndex && i < trace.length; i++) {
          maxValue = Math.max(maxValue, trace[i]);
        }
      });
      if (maxValue === 0) maxValue = 1;

      const baselineY = rowY + baseCallHeight + traceHeight;

      // Draw traces for this row
      Object.entries(traces).forEach(([base, data]) => {
        if (!showChannels[base] || data.length === 0) return;

        ctx.strokeStyle = colors[base];
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();

        let pathStarted = false;

        for (let i = startTraceIndex; i < endTraceIndex && i < data.length; i++) {
          const x = ((i - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width;
          const normalizedValue = (data[i] / maxValue) * traceHeight;
          const y = baselineY - normalizedValue;

          if (!pathStarted) {
            ctx.moveTo(x, y);
            pathStarted = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      });

      // Draw ORFs above base calls for this row
      if (showORFs && detectedORFs.length > 0) {
        const orfHeight = 14;
        const orfYOffset = 35;

        detectedORFs.forEach((orf, idx) => {
          const startPos = orf.start;
          const endPos = orf.end;

          // Check if ORF overlaps with this row
          if (endPos >= startBase && startPos < endBase) {
            const rowStartPos = Math.max(startPos, startBase);
            const rowEndPos = Math.min(endPos, endBase - 1);

            const startPeakPosition = peakLocations && peakLocations[rowStartPos]
              ? peakLocations[rowStartPos]
              : (rowStartPos * maxTraceLength / baseCalls.length);
            const endPeakPosition = peakLocations && peakLocations[rowEndPos]
              ? peakLocations[rowEndPos]
              : (rowEndPos * maxTraceLength / baseCalls.length);

            const startX = Math.max(0, ((startPeakPosition - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width);
            const endX = Math.min(canvas.width, ((endPeakPosition - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width);

            // Calculate Y position based on frame
            const frameIndex = ['+1', '+2', '+3', '-1', '-2', '-3'].indexOf(orf.frame);
            const yPos = rowY + orfYOffset + (frameIndex * (orfHeight + 2));

            // Color based on frame
            const isForward = orf.strand === '+';
            const colors = isForward
              ? ['#3B82F6', '#60A5FA', '#93C5FD']
              : ['#F97316', '#FB923C', '#FDBA74'];
            const colorIndex = isForward ? frameIndex : frameIndex - 3;

            const isSelected = selectedORF === idx;
            ctx.fillStyle = isSelected ? '#4F46E5' : colors[colorIndex];
            ctx.fillRect(startX, yPos, endX - startX, orfHeight);

            // Draw amino acids inside the ORF box, aligned to codon positions
            if (orf.aminoAcids) {
              ctx.font = 'bold 12px monospace';
              ctx.fillStyle = '#FFFFFF';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';

              // Draw each amino acid at the position of the middle base of its codon
              for (let i = 0; i < orf.aminoAcids.length; i++) {
                const codonStartPos = orf.start + (i * 3); // Position of first base in codon
                const middleBasePos = codonStartPos + 1;  // Position of middle base

                // Check if this codon overlaps with this row
                if (middleBasePos >= startBase && middleBasePos < endBase) {
                  // Get peak position for the middle base
                  const middlePeakPosition = peakLocations && peakLocations[middleBasePos]
                    ? peakLocations[middleBasePos]
                    : (middleBasePos * maxTraceLength / baseCalls.length);

                  const x = ((middlePeakPosition - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width;

                  // Only draw if within canvas bounds
                  if (x >= 0 && x <= canvas.width) {
                    ctx.fillText(orf.aminoAcids[i], x, yPos + orfHeight / 2);
                  }
                }
              }
            }

            if (isSelected) {
              ctx.strokeStyle = '#312E81';
              ctx.lineWidth = 2;
              ctx.strokeRect(startX, yPos, endX - startX, orfHeight);
            }
          }
        });
      }

      // Draw selection range for this row
      // Use ref for immediate updates during dragging
      const currentSelection = selectionRangeRef.current || selectionRange;
      if (currentSelection !== null) {
        const { start, end } = currentSelection;

        // Check if selection overlaps with this row
        if (end >= startBase && start < endBase) {
          const rowStartPos = Math.max(start, startBase);
          const rowEndPos = Math.min(end, endBase - 1);

          const startPeakPosition = peakLocations && peakLocations[rowStartPos]
            ? peakLocations[rowStartPos]
            : (rowStartPos * maxTraceLength / baseCalls.length);
          const endPeakPosition = peakLocations && peakLocations[rowEndPos]
            ? peakLocations[rowEndPos]
            : (rowEndPos * maxTraceLength / baseCalls.length);

          // Add padding to encompass the entire base letter (12px on each side)
          const basePadding = 12;
          const rawStartX = ((startPeakPosition - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width;
          const rawEndX = ((endPeakPosition - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width;
          const startX = Math.max(0, rawStartX - basePadding);
          const endX = Math.min(canvas.width, rawEndX + basePadding);

          // Semi-transparent blue overlay
          ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
          ctx.fillRect(startX, rowY, endX - startX, rowHeight);

          // Border
          ctx.strokeStyle = '#3B82F6';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(startX, rowY, endX - startX, rowHeight);
          ctx.setLineDash([]);
        }
      }

      // Draw base calls and quality for this row
      ctx.font = 'bold 16px monospace';

      for (let i = startBase; i < endBase; i++) {
        const peakPosition = peakLocations && peakLocations[i]
          ? peakLocations[i]
          : (i * maxTraceLength / baseCalls.length);

        const x = ((peakPosition - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width;
        const base = baseCalls[i];
        const qual = quality[i] || 0;

        if (x >= -20 && x <= canvas.width + 20) {
          // Highlight selected position
          if (selectedPosition === i) {
            ctx.fillStyle = '#FFD700';
            ctx.fillRect(x - 12, rowY + 5, 24, baseCallHeight - 5);
            ctx.strokeStyle = '#FF6600';
            ctx.lineWidth = 2;
            ctx.strokeRect(x - 12, rowY + 5, 24, baseCallHeight - 5);
          }

          // Highlight N bases
          if (base === 'N') {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            ctx.fillRect(x - 12, rowY + 5, 24, baseCallHeight - 5);
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 1;
            ctx.strokeRect(x - 12, rowY + 5, 24, baseCallHeight - 5);
          }

          // Highlight edited positions
          if (editedPositions.has(i)) {
            ctx.fillStyle = 'rgba(128, 0, 255, 0.3)';
            ctx.fillRect(x - 12, rowY + 5, 24, baseCallHeight - 5);
            ctx.strokeStyle = '#8000FF';
            ctx.lineWidth = 1;
            ctx.strokeRect(x - 12, rowY + 5, 24, baseCallHeight - 5);
          }

          // Draw base letter
          ctx.fillStyle = colors[base] || '#666666';
          ctx.fillText(base, x - 6, rowY + baseCallHeight - 5);

          // Draw quality bar
          ctx.fillStyle = qual >= qualityThreshold ? colors[base] || '#666666' : '#CCCCCC';
          const barHeight = (qual / 60) * 12;
          ctx.fillRect(x - 2, baselineY + 5, 4, barHeight);
        }
      }

      // Draw position markers for this row
      ctx.fillStyle = '#666666';
      ctx.font = '24px monospace';

      const positionInterval = zoomLevel > 10 ? 10 : zoomLevel > 5 ? 25 : 50;

      for (let pos = startBase; pos < endBase; pos += positionInterval) {
        const peakPosition = peakLocations && peakLocations[pos]
          ? peakLocations[pos]
          : (pos * maxTraceLength / baseCalls.length);

        const x = ((peakPosition - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width;

        if (x >= 0 && x <= canvas.width) {
          ctx.fillStyle = '#666666';
          ctx.fillText((pos + 1).toString(), x - 10, rowY + rowHeight - 5);

          ctx.strokeStyle = '#CCCCCC';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, baselineY + 20);
          ctx.lineTo(x, rowY + rowHeight - 15);
          ctx.stroke();
        }
      }

      // Draw selected position highlight line for this row
      if (selectedPosition !== null && selectedPosition >= startBase && selectedPosition < endBase) {
        const peakPosition = peakLocations && peakLocations[selectedPosition]
          ? peakLocations[selectedPosition]
          : (selectedPosition * maxTraceLength / baseCalls.length);

        const selectedX = ((peakPosition - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width;
        if (selectedX >= 0 && selectedX <= canvas.width) {
          ctx.strokeStyle = '#FF6600';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(selectedX, rowY + baseCallHeight);
          ctx.lineTo(selectedX, baselineY + 20);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Draw hover highlight for this row
      if (hoveredPosition !== null && hoveredPosition !== selectedPosition && hoveredPosition >= startBase && hoveredPosition < endBase) {
        const peakPosition = peakLocations && peakLocations[hoveredPosition]
          ? peakLocations[hoveredPosition]
          : (hoveredPosition * maxTraceLength / baseCalls.length);

        const hoverX = ((peakPosition - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width;
        if (hoverX >= 0 && hoverX <= canvas.width) {
          ctx.fillStyle = 'rgba(173, 216, 230, 0.4)';
          ctx.fillRect(hoverX - 12, rowY + 5, 24, baselineY + 20 - (rowY + 5));
        }
      }

      // Draw quality threshold line for this row
      ctx.strokeStyle = '#FF6B6B';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      const thresholdY = baselineY + 20 + (qualityThreshold / 60) * 12;
      ctx.moveTo(0, thresholdY);
      ctx.lineTo(canvas.width, thresholdY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw search matches for this row
      if (searchMatches.length > 0) {
        searchMatches.forEach((match, idx) => {
          const startPos = match.position;
          const endPos = match.endPosition;

          // Check if match overlaps with this row
          if (endPos >= startBase && startPos < endBase) {
            const rowStartPos = Math.max(startPos, startBase);
            const rowEndPos = Math.min(endPos, endBase - 1);

            const startPeakPosition = peakLocations && peakLocations[rowStartPos]
              ? peakLocations[rowStartPos]
              : (rowStartPos * maxTraceLength / baseCalls.length);
            const endPeakPosition = peakLocations && peakLocations[rowEndPos]
              ? peakLocations[rowEndPos]
              : (rowEndPos * maxTraceLength / baseCalls.length);

            const startX = Math.max(0, ((startPeakPosition - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width);
            const endX = Math.min(canvas.width, ((endPeakPosition - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width);

            // Different color for current match vs other matches
            const isCurrentMatch = idx === currentMatchIndex;
            ctx.fillStyle = isCurrentMatch ? 'rgba(0, 255, 0, 0.3)' : 'rgba(135, 206, 250, 0.25)';
            ctx.fillRect(startX - 12, rowY + 5, endX - startX + 24, baselineY + 20 - (rowY + 5));

            // Draw border for current match
            if (isCurrentMatch) {
              ctx.strokeStyle = '#00AA00';
              ctx.lineWidth = 2;
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(startX, rowY + 5);
              ctx.lineTo(startX, baselineY + 20);
              ctx.moveTo(endX, rowY + 5);
              ctx.lineTo(endX, baselineY + 20);
              ctx.stroke();
            }
          }
        });
      }

      // Draw restriction enzyme cut sites for this row
      if (showRestrictionSites && restrictionSites.length > 0) {
        restrictionSites.forEach(site => {
          const basePosition = site.cutPosition;

          // Check if this site is in the current row
          if (basePosition >= startBase && basePosition < endBase) {
            const peakPosition = peakLocations && peakLocations[basePosition]
              ? peakLocations[basePosition]
              : (basePosition * maxTraceLength / baseCalls.length);

            const x = ((peakPosition - startTraceIndex) / (endTraceIndex - startTraceIndex)) * canvas.width;

            if (x >= 0 && x <= canvas.width) {
              // Draw purple vertical line for cut site
              ctx.strokeStyle = '#9333EA';
              ctx.lineWidth = 2;
              ctx.setLineDash([]);
              ctx.globalAlpha = 0.6;
              ctx.beginPath();
              ctx.moveTo(x, rowY + baseCallHeight);
              ctx.lineTo(x, baselineY + 20);
              ctx.stroke();
              ctx.globalAlpha = 1.0;

              // Draw enzyme name
              ctx.fillStyle = '#9333EA';
              ctx.font = 'bold 16px "Courier New", monospace';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'top';
              ctx.fillText(site.enzyme, x + 4, rowY + baseCallHeight + 2);
            }
          }
        });
      }
    }
  };

  const handleZoom = (delta) => {
    setZoomLevel(prev => Math.max(0.5, Math.min(20, prev + delta)));
  };

  // Handle navigation (moved to double-click)
  const handleNavigation = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const scrollRatio = x / rect.width;
    setScrollPosition(Math.max(0, Math.min(1, scrollRatio)));
  };

  // FIX: Improved canvas click handling
  // Updated handleCanvasClick
  const handleCanvasClick = (e) => {
    if (!parsedData) return;

    // CRITICAL: Ignore clicks that were part of a drag operation
    if (isDragging || dragStartPosition !== null) {
      return;
    }

    // CRITICAL: Time-based click blocking after touch end
    // Prevents clicks that fire shortly after a scroll gesture
    const timeSinceTouchEnd = performance.now() - lastTouchEndTimeRef.current;
    const CLICK_BLOCK_WINDOW = 200; // ms - block clicks within this window after touch

    if (timeSinceTouchEnd < CLICK_BLOCK_WINDOW) {
      console.log('Click blocked: too soon after touch end', timeSinceTouchEnd + 'ms');
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // CRITICAL: Prevent click if user just scrolled (touch gesture conflict resolution)
    if (preventClickRef.current) {
      console.log('Click blocked: was a scroll gesture');
      preventClickRef.current = false; // Reset for next interaction
      e.preventDefault();
      e.stopPropagation();
      return; // Don't process this click - it was actually a scroll
    }

    // CRITICAL: Block clicks during active touch scrolling or inertia
    if (touchState.current.isActive || inertiaState.current.isActive) {
      console.log('Click blocked: scroll in progress');
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    console.log('Click at canvas X:', canvasX, 'Y:', canvasY);

    const traceLengths = Object.values(parsedData.traces).map(trace => trace.length);
    const maxTraceLength = Math.max(...traceLengths);

    let startIndex, endIndex;

    if (layoutMode === 'wrapped') {
      // In wrapped mode, determine which row was clicked
      const rowHeight = 200;
      const tracePointsPerRow = Math.floor(canvas.width / zoomLevel);
      const row = Math.floor(canvasY / rowHeight);

      // Calculate the trace range for this row
      startIndex = row * tracePointsPerRow;
      endIndex = Math.min(startIndex + tracePointsPerRow, maxTraceLength);

      console.log('Wrapped mode - Row:', row, 'Range:', startIndex, 'to', endIndex);
    } else {
      // Horizontal mode - use scroll position
      const dataLength = maxTraceLength;
      const visiblePoints = Math.floor(canvas.width / zoomLevel);
      startIndex = Math.floor(scrollPosition * (dataLength - visiblePoints));
      endIndex = Math.min(startIndex + visiblePoints, dataLength);

      console.log('Horizontal mode - Visible range:', startIndex, 'to', endIndex);
    }

    // Find the closest base call position
    let closestPosition = null;
    let closestDistance = Infinity;

    // Use display data (forward or reverse complement)
    const displayData = showReverseComplement ? getReverseComplementData(parsedData) : parsedData;

    for (let i = 0; i < displayData.baseCalls.length; i++) {
      const peakPosition = displayData.peakLocations && displayData.peakLocations[i]
        ? displayData.peakLocations[i]
        : (i * maxTraceLength / displayData.baseCalls.length);

      if (peakPosition < startIndex || peakPosition > endIndex) continue;

      const baseX = ((peakPosition - startIndex) / (endIndex - startIndex)) * canvas.width;
      const distance = Math.abs(canvasX - baseX);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestPosition = i;
      }
    }

    console.log('Closest position:', closestPosition, 'Distance:', closestDistance);

    if (closestPosition !== null && closestDistance < 50 && closestPosition >= 0) {
      const nucleotide = displayData.baseCalls[closestPosition];
      setSelectedPosition(closestPosition);
      setSelectedNucleotide(nucleotide);
      console.log(`Selected: ${nucleotide}${closestPosition + 1}`);
    } else {
      console.log('Click too far from any base position or invalid position');
      setSelectedPosition(null);
      setSelectedNucleotide(null);
    }
  };

  // Updated handleCanvasMouseMove
  const handleCanvasMouseMove = (e) => {
    // Handle drag selection first
    handleCanvasMouseMoveForDrag(e);

    if (!parsedData) return;

    // CRITICAL: Skip hover updates during active touch scrolling only
    // (not during inertia - we want hover to work when user moves mouse)
    if (touchState.current.isActive) {
      return;
    }

    // Also skip if this is a touch-generated mouse event (some browsers do this)
    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) {
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    const traceLengths = Object.values(parsedData.traces).map(trace => trace.length);
    const maxTraceLength = Math.max(...traceLengths);

    let startIndex, endIndex;

    if (layoutMode === 'wrapped') {
      // In wrapped mode, determine which row was hovered
      const rowHeight = 200;
      const tracePointsPerRow = Math.floor(canvas.width / zoomLevel);
      const row = Math.floor(canvasY / rowHeight);

      // Calculate the trace range for this row
      startIndex = row * tracePointsPerRow;
      endIndex = Math.min(startIndex + tracePointsPerRow, maxTraceLength);
    } else {
      // Horizontal mode - use scrollOffsetRef during inertia, otherwise use React state
      const currentScrollPos = inertiaState.current.isActive ? scrollOffsetRef.current : scrollPosition;
      const dataLength = maxTraceLength;
      const visiblePoints = Math.floor(canvas.width / zoomLevel);
      startIndex = Math.floor(currentScrollPos * (dataLength - visiblePoints));
      endIndex = Math.min(startIndex + visiblePoints, dataLength);
    }

    // Find closest position
    let closestPosition = null;
    let closestDistance = Infinity;

    // Use display data (forward or reverse complement)
    const displayData = showReverseComplement ? getReverseComplementData(parsedData) : parsedData;

    for (let i = 0; i < displayData.baseCalls.length; i++) {
      const peakPosition = displayData.peakLocations && displayData.peakLocations[i]
        ? displayData.peakLocations[i]
        : (i * maxTraceLength / displayData.baseCalls.length);

      if (peakPosition < startIndex || peakPosition > endIndex) continue;

      const baseX = ((peakPosition - startIndex) / (endIndex - startIndex)) * canvas.width;
      const distance = Math.abs(canvasX - baseX);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestPosition = i;
      }
    }

    if (closestPosition !== null && closestDistance < 50 && closestPosition >= 0) {
      setHoveredPosition(closestPosition);
    } else {
      setHoveredPosition(null);
    }
  };

  // Add mouse leave handler
  const handleCanvasMouseLeave = () => {
    setHoveredPosition(null);
  };

  // Handle mouse down for drag selection
  const handleCanvasMouseDown = (e) => {
    // Skip if currently scrolling
    if (touchState.current.isActive || inertiaState.current.isActive) {
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    const position = getBasePositionFromCanvas(canvasX, canvasY);

    if (position !== null) {
      setIsDragging(true);
      setDragStartPosition(position);
      // Clear any existing selection when starting new drag
      selectionRangeRef.current = null;
      setSelectionRange(null);
    }
  };

  // Handle mouse move during drag
  const handleCanvasMouseMoveForDrag = (e) => {
    // Skip if not dragging or if touch scrolling
    if (!isDragging || touchState.current.isActive) {
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    // Auto-scroll detection based on layout mode
    if (layoutMode === 'horizontal') {
      const edgeThreshold = 50; // pixels from edge
      const mouseScreenX = e.clientX - rect.left;

      if (mouseScreenX < edgeThreshold && scrollOffsetRef.current > 0) {
        // Near left edge - scroll left
        startAutoScroll(-1, 'horizontal');
      } else if (mouseScreenX > rect.width - edgeThreshold && scrollOffsetRef.current < 1) {
        // Near right edge - scroll right
        startAutoScroll(1, 'horizontal');
      } else {
        // Not near edge - stop auto-scroll
        stopAutoScroll();
      }
    } else if (layoutMode === 'wrapped') {
      // Wrapped mode: check vertical position relative to viewport
      const container = canvas.parentElement;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const edgeThreshold = 50;
        const mouseViewportY = e.clientY - containerRect.top;

        if (mouseViewportY < edgeThreshold && container.scrollTop > 0) {
          // Near top edge - scroll up
          startAutoScroll(-1, 'wrapped');
        } else if (mouseViewportY > containerRect.height - edgeThreshold &&
                   container.scrollTop < container.scrollHeight - container.clientHeight) {
          // Near bottom edge - scroll down
          startAutoScroll(1, 'wrapped');
        } else {
          // Not near edge - stop auto-scroll
          stopAutoScroll();
        }
      }
    }

    const currentPosition = getBasePositionFromCanvas(canvasX, canvasY);

    if (currentPosition !== null && dragStartPosition !== null) {
      // Create selection range (ensure start < end)
      const start = Math.min(dragStartPosition, currentPosition);
      const end = Math.max(dragStartPosition, currentPosition);
      const newRange = { start, end };

      // Update both state and ref (ref is used for immediate drawing)
      selectionRangeRef.current = newRange;
      setSelectionRange(newRange);

      // Manually redraw to show updated selection
      drawChromatogram();
    }
  };

  // Handle mouse up to finalize selection
  const handleCanvasMouseUp = (e) => {
    if (!isDragging) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    const endPosition = getBasePositionFromCanvas(canvasX, canvasY);

    if (endPosition !== null && dragStartPosition !== null) {
      const start = Math.min(dragStartPosition, endPosition);
      const end = Math.max(dragStartPosition, endPosition);

      // Only set selection if range is more than 1 base (prevent single-click selections)
      if (end > start) {
        const newRange = { start, end };
        selectionRangeRef.current = newRange;
        setSelectionRange(newRange);
      } else {
        // Single click - clear selection and let handleCanvasClick handle it
        selectionRangeRef.current = null;
        setSelectionRange(null);
      }
    }

    setIsDragging(false);
    setDragStartPosition(null);
    stopAutoScroll();
  };

  const handleScrollbarChange = (e) => {
    // Stop any ongoing inertia
    stopInertia();

    const newPosition = parseFloat(e.target.value) / 10000;
    scrollOffsetRef.current = newPosition;
    setScrollPosition(newPosition);
  };

  const resetView = () => {
    // Stop any ongoing inertia
    stopInertia();

    setZoomLevel(2.5);
    scrollOffsetRef.current = 0;
    setScrollPosition(0);
    // Clear selection when resetting view
    setSelectedPosition(null);
    setSelectedNucleotide(null);
  };

  // Reverse complement helper functions
  const getComplement = (base) => {
    const complements = { 'A': 'T', 'T': 'A', 'G': 'C', 'C': 'G', 'N': 'N' };
    return complements[base.toUpperCase()] || base;
  };

  // Translate codon to amino acid (single letter code)
  const translateCodon = (codon) => {
    const codonTable = {
      'TTT': 'F', 'TTC': 'F', 'TTA': 'L', 'TTG': 'L',
      'TCT': 'S', 'TCC': 'S', 'TCA': 'S', 'TCG': 'S',
      'TAT': 'Y', 'TAC': 'Y', 'TAA': '*', 'TAG': '*',
      'TGT': 'C', 'TGC': 'C', 'TGA': '*', 'TGG': 'W',
      'CTT': 'L', 'CTC': 'L', 'CTA': 'L', 'CTG': 'L',
      'CCT': 'P', 'CCC': 'P', 'CCA': 'P', 'CCG': 'P',
      'CAT': 'H', 'CAC': 'H', 'CAA': 'Q', 'CAG': 'Q',
      'CGT': 'R', 'CGC': 'R', 'CGA': 'R', 'CGG': 'R',
      'ATT': 'I', 'ATC': 'I', 'ATA': 'I', 'ATG': 'M',
      'ACT': 'T', 'ACC': 'T', 'ACA': 'T', 'ACG': 'T',
      'AAT': 'N', 'AAC': 'N', 'AAA': 'K', 'AAG': 'K',
      'AGT': 'S', 'AGC': 'S', 'AGA': 'R', 'AGG': 'R',
      'GTT': 'V', 'GTC': 'V', 'GTA': 'V', 'GTG': 'V',
      'GCT': 'A', 'GCC': 'A', 'GCA': 'A', 'GCG': 'A',
      'GAT': 'D', 'GAC': 'D', 'GAA': 'E', 'GAG': 'E',
      'GGT': 'G', 'GGC': 'G', 'GGA': 'G', 'GGG': 'G'
    };
    return codonTable[codon.toUpperCase()] || 'X';
  };

  // Translate nucleotide sequence to amino acids
  const translateSequence = (sequence) => {
    const aa = [];
    for (let i = 0; i < sequence.length - 2; i += 3) {
      const codon = sequence.substring(i, i + 3);
      aa.push(translateCodon(codon));
    }
    return aa.join('');
  };

  // IUPAC nucleotide code matching
  const iupacMatch = (base, pattern) => {
    const iupacCodes = {
      'A': ['A'],
      'T': ['T'],
      'G': ['G'],
      'C': ['C'],
      'R': ['A', 'G'],      // puRine
      'Y': ['C', 'T'],      // pYrimidine
      'S': ['G', 'C'],      // Strong
      'W': ['A', 'T'],      // Weak
      'K': ['G', 'T'],      // Keto
      'M': ['A', 'C'],      // aMino
      'B': ['C', 'G', 'T'], // not A
      'D': ['A', 'G', 'T'], // not C
      'H': ['A', 'C', 'T'], // not G
      'V': ['A', 'C', 'G'], // not T
      'N': ['A', 'C', 'G', 'T'] // aNy
    };

    const patternUpper = pattern.toUpperCase();
    const baseUpper = base.toUpperCase();

    if (!iupacCodes[patternUpper]) return false;
    return iupacCodes[patternUpper].includes(baseUpper);
  };

  // Search for sequence pattern with IUPAC support
  const searchSequence = useCallback((sequence, query) => {
    if (!sequence || !query || query.length === 0) return [];

    const matches = [];
    const queryUpper = query.toUpperCase();

    for (let i = 0; i <= sequence.length - query.length; i++) {
      let isMatch = true;

      for (let j = 0; j < query.length; j++) {
        if (!iupacMatch(sequence[i + j], queryUpper[j])) {
          isMatch = false;
          break;
        }
      }

      if (isMatch) {
        matches.push({
          position: i,
          endPosition: i + query.length - 1,
          matchedSequence: sequence.substring(i, i + query.length)
        });
      }
    }

    return matches;
  }, []);

  // Effect to perform search when query or data changes
  useEffect(() => {
    if (parsedData && searchQuery.trim().length > 0) {
      const displayData = showReverseComplement ? getReverseComplementData(parsedData) : parsedData;
      const matches = searchSequence(displayData.sequence, searchQuery);
      setSearchMatches(matches);
      setCurrentMatchIndex(0);
    } else {
      setSearchMatches([]);
      setCurrentMatchIndex(0);
    }
  }, [parsedData, searchQuery, showReverseComplement, searchSequence]);

  // ORF Detection
  const findORFs = useCallback((sequence, frames, minLength) => {
    if (!sequence || sequence.length < 3) return [];

    const startCodons = ['ATG'];
    const stopCodons = ['TAA', 'TAG', 'TGA'];
    const orfs = [];

    // Process each frame
    frames.forEach(frame => {
      const isForward = frame.startsWith('+');
      const frameNum = parseInt(frame.replace(/[+-]/, ''));
      const offset = frameNum - 1; // Convert to 0-indexed

      let seq = sequence;

      // For reverse frames, use reverse complement
      if (!isForward) {
        seq = [...sequence].reverse().map(base => {
          const comp = { 'A': 'T', 'T': 'A', 'G': 'C', 'C': 'G', 'N': 'N' };
          return comp[base.toUpperCase()] || base;
        }).join('');
      }

      // Scan through the sequence in this frame
      for (let i = offset; i < seq.length - 2; i += 3) {
        const codon = seq.substring(i, i + 3);

        if (startCodons.includes(codon)) {
          // Found a start codon, look for stop codon
          let j = i + 3;
          let foundStop = false;

          while (j < seq.length - 2) {
            const stopCodon = seq.substring(j, j + 3);

            if (stopCodons.includes(stopCodon)) {
              foundStop = true;
              const orfLength = j + 3 - i;

              if (orfLength >= minLength) {
                const orfSeq = seq.substring(i, j + 3);

                // Convert positions back to original sequence coordinates
                let startPos, endPos;
                if (isForward) {
                  startPos = i;
                  endPos = j + 2;
                } else {
                  // Reverse frame positions need to be flipped
                  startPos = sequence.length - (j + 3);
                  endPos = sequence.length - i - 1;
                }

                // Translate to amino acids
                const aaSeq = translateSequence(orfSeq);

                orfs.push({
                  frame,
                  start: startPos,
                  end: endPos,
                  length: orfLength,
                  lengthAA: Math.floor(orfLength / 3),
                  sequence: orfSeq,
                  aminoAcids: aaSeq,
                  strand: isForward ? '+' : '-'
                });
              }
              break;
            }
            j += 3;
          }

          // If we found a stop, skip past it to look for next ORF
          if (foundStop) {
            i = j;
          }
        }
      }
    });

    return orfs;
  }, []);

  // Effect to detect ORFs when sequence or settings change
  useEffect(() => {
    if (parsedData && selectedFrames.length > 0) {
      const displayData = showReverseComplement ? getReverseComplementData(parsedData) : parsedData;
      const orfs = findORFs(displayData.sequence, selectedFrames, minORFLength);
      setDetectedORFs(orfs);
    } else {
      setDetectedORFs([]);
    }
  }, [parsedData, selectedFrames, minORFLength, showReverseComplement, findORFs]);

  // Force render after ORFs/RE sites are computed (critical for mobile)
  useEffect(() => {
    if (parsedData && canvasRef.current && (detectedORFs.length > 0 || restrictionSites.length > 0)) {
      // Extra RAF to ensure state has fully propagated on mobile
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (canvasRef.current) {
            drawChromatogram();
          }
        });
      });
    }
  }, [detectedORFs, restrictionSites]);

  const getReverseComplementData = (data) => {
    if (!data) return null;

    // Reverse and complement the sequence
    const reversedBaseCalls = [...data.baseCalls].reverse().map(getComplement);
    const reversedSequence = reversedBaseCalls.join('');

    // Reverse the trace data
    const reversedTraces = {
      A: [...data.traces.T].reverse(), // A↔T
      T: [...data.traces.A].reverse(), // T↔A
      G: [...data.traces.C].reverse(), // G↔C
      C: [...data.traces.G].reverse(), // C↔G
    };

    // Reverse quality scores
    const reversedQuality = data.quality ? [...data.quality].reverse() : [];

    // Reverse peak locations and adjust positions
    const reversedPeakLocations = data.peakLocations
      ? [...data.peakLocations].reverse().map((peak) => {
          const maxTraceLength = Math.max(...Object.values(data.traces).map(t => t.length));
          return maxTraceLength - peak;
        })
      : [];

    return {
      ...data,
      baseCalls: reversedBaseCalls,
      sequence: reversedSequence,
      traces: reversedTraces,
      quality: reversedQuality,
      peakLocations: reversedPeakLocations,
    };
  };

  const toggleChannel = (channel) => {
    setShowChannels(prev => ({
      ...prev,
      [channel]: !prev[channel]
    }));
  };

  const exportSequence = () => {
    if (!parsedData) return;

    // Export the currently displayed sequence (forward or reverse complement)
    const displayData = showReverseComplement ? getReverseComplementData(parsedData) : parsedData;
    const header = showReverseComplement ? `${fileName} (reverse complement)` : fileName;
    const fasta = `>${header}\n${displayData.sequence}`;
    const blob = new Blob([fasta], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const suffix = showReverseComplement ? '_rc' : '';
    a.href = url;
    a.download = `${fileName.replace(/\.(ab1|scf)$/i, '')}${suffix}.fasta`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Open NCBI BLAST with sequence
  const openBLAST = (sequence, label, isProtein = false) => {
    if (!sequence || sequence.length === 0) {
      console.error('Cannot BLAST empty sequence');
      return;
    }

    // NCBI BLAST search page
    const baseUrl = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi';

    // Format sequence as FASTA
    const fastaSequence = `>${label}\n${sequence}`;

    // URL encode the sequence
    const encodedSequence = encodeURIComponent(fastaSequence);

    // Construct URL with parameters
    // PROGRAM=blastn (nucleotide) or blastp (protein)
    // PAGE_TYPE=BlastSearch (web interface search page)
    // QUERY=sequence
    const program = isProtein ? 'blastp' : 'blastn';
    const url = `${baseUrl}?PROGRAM=${program}&PAGE_TYPE=BlastSearch&LINK_LOC=blasthome&QUERY=${encodedSequence}`;

    // Open in new tab
    window.open(url, '_blank', 'noopener,noreferrer');

    const seqType = isProtein ? 'aa' : 'bp';
    console.log(`Opened BLAST${isProtein ? 'p' : 'n'} for ${label} (${sequence.length} ${seqType})`);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Parsing chromatogram data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    // Special handling for ZTR format files
    if (error === 'ZTR_FORMAT') {
      return (
        <div className="bg-white rounded-lg border p-6">
          <div className="text-center py-8">
            <div className="mb-6">
              <svg className="w-16 h-16 mx-auto text-yellow-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h3 className="text-2xl font-bold text-yellow-600 mb-2">Unsupported File Format</h3>
              <p className="text-lg text-gray-700 mb-2">This chromatogram file is in ZTR format, which is not currently supported.</p>
              <p className="text-md text-gray-600">Please contact a Director to convert this file to AB1 or SCF format.</p>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700"
              >
                Close
              </button>
            )}
          </div>
        </div>
      );
    }

    // Generic error for other issues
    return (
      <div className="bg-white rounded-lg border p-6">
        <div className="text-center py-8">
          <div className="mb-6">
            <svg className="w-16 h-16 mx-auto text-red-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="text-2xl font-bold text-red-600 mb-2">Could not load Chromatogram Data</h3>
            <p className="text-lg text-gray-700">Please contact a Director to fix this issue</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white flex h-full relative">
      {/* Confirmation Modal */}
      {showConfirmModal && pendingEdit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={cancelBaseEdit}>
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Confirm Base Change</h3>
            <div className="mb-6">
              <p className="text-gray-700 mb-2">
                Change position <span className="font-bold">{pendingEdit.position + 1}</span>?
              </p>
              <div className="flex items-center justify-center space-x-4 p-4 bg-gray-50 rounded">
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">From</div>
                  <div className="text-2xl font-bold text-red-600">{pendingEdit.oldBase}</div>
                </div>
                <div className="text-2xl text-gray-400">&rarr;</div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">To</div>
                  <div className="text-2xl font-bold text-green-600">{pendingEdit.newBase}</div>
                </div>
              </div>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={cancelBaseEdit}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={confirmBaseEdit}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collapsible Sidebar */}
      <div className={`${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-300 bg-gray-50 border-r border-gray-200 flex flex-col overflow-hidden`}>
        <div className="flex-1 overflow-y-auto p-4">
          {/* File Info */}
          <div className="mb-4 pb-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">File</h4>
            <p className="text-xs text-gray-600 break-all">{fileName || 'Chromatogram'}</p>
          </div>

          {/* Selected Position */}
          {selectedPosition !== null && selectedNucleotide && (
            <div className="mb-4 pb-4 border-b border-gray-200">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Selected</h4>
              <div className="bg-orange-50 border border-orange-200 rounded p-3">
                <p className="text-sm text-orange-900 font-medium mb-1">
                  {selectedNucleotide}{selectedPosition + 1}
                </p>
                <p className="text-xs text-orange-700 mb-2">Press A/T/G/C/N to edit</p>
                {editedPositions.has(selectedPosition) && (
                  <span className="text-xs text-green-600 font-medium">✓ Edited</span>
                )}
                <button
                  onClick={() => {
                    setSelectedPosition(null);
                    setSelectedNucleotide(null);
                  }}
                  className="mt-2 w-full text-sm px-2 py-1 bg-orange-600 text-white rounded hover:bg-orange-700"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}

          {/* Highlight Region - Merged with Selection */}
          <div className="mb-4 pb-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Highlight Region</h4>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  value={selectionRange ? selectionRange.start + 1 : ''}
                  onChange={(e) => {
                    const startPos = parseInt(e.target.value) - 1;
                    if (!isNaN(startPos) && startPos >= 0 && parsedData) {
                      const endPos = selectionRange ? selectionRange.end : startPos;
                      if (startPos <= endPos && endPos < parsedData.baseCalls.length) {
                        const newRange = { start: startPos, end: endPos };
                        selectionRangeRef.current = newRange;
                        setSelectionRange(newRange);
                      }
                    }
                  }}
                  placeholder="Start"
                  min="1"
                  max={parsedData?.baseCalls?.length || 0}
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                />
                <span className="text-sm text-gray-500">to</span>
                <input
                  type="number"
                  value={selectionRange ? selectionRange.end + 1 : ''}
                  onChange={(e) => {
                    const endPos = parseInt(e.target.value) - 1;
                    if (!isNaN(endPos) && endPos >= 0 && parsedData) {
                      const startPos = selectionRange ? selectionRange.start : endPos;
                      if (startPos <= endPos && endPos < parsedData.baseCalls.length) {
                        const newRange = { start: startPos, end: endPos };
                        selectionRangeRef.current = newRange;
                        setSelectionRange(newRange);
                      }
                    }
                  }}
                  placeholder="End"
                  min="1"
                  max={parsedData?.baseCalls?.length || 1}
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                />
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => {
                    selectionRangeRef.current = null;
                    setSelectionRange(null);
                  }}
                  disabled={!selectionRange}
                  className="flex-1 px-2 py-1 text-sm bg-white text-blue-700 border border-blue-300 rounded hover:bg-blue-50 disabled:opacity-50"
                >
                  Clear
                </button>
                <button
                  onClick={() => {
                    if (selectionRange && parsedData) {
                      const displayData = showReverseComplement ? getReverseComplementData(parsedData) : parsedData;
                      const sequence = displayData.baseCalls.slice(selectionRange.start, selectionRange.end + 1).join('');
                      navigator.clipboard.writeText(sequence);
                    }
                  }}
                  disabled={!selectionRange}
                  className="flex-1 px-2 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Copy
                </button>
              </div>
              {selectionRange && parsedData && (
                <p className="text-xs text-gray-600 text-center">
                  {selectionRange.end - selectionRange.start + 1} bases
                </p>
              )}
            </div>
          </div>

          {/* Restriction Enzymes */}
          <div className="mb-4 pb-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center">
              <Scissors className="w-4 h-4 mr-2" />
              Restriction Sites
            </h4>

            {/* Popular enzymes quick select */}
            <div className="mb-2">
              <p className="text-xs text-gray-500 mb-2">Popular:</p>
              <div className="flex flex-wrap gap-1">
                {['EcoRI', 'BamHI', 'HindIII', 'PstI', 'XbaI'].map(enzyme => (
                  <button
                    key={enzyme}
                    onClick={() => {
                      if (selectedEnzymes.includes(enzyme)) {
                        setSelectedEnzymes(selectedEnzymes.filter(e => e !== enzyme));
                      } else {
                        setSelectedEnzymes([...selectedEnzymes, enzyme]);
                      }
                    }}
                    className={`px-2 py-1 text-xs rounded ${
                      selectedEnzymes.includes(enzyme)
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {enzyme}
                  </button>
                ))}
              </div>
            </div>

            {/* All enzymes dropdown */}
            <details className="mb-2">
              <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-800">
                All Enzymes ({restrictionEnzymes.length})
              </summary>
              <div className="mt-2">
                {/* Search input */}
                <input
                  type="text"
                  placeholder="Search enzymes..."
                  value={enzymeSearchQuery}
                  onChange={(e) => setEnzymeSearchQuery(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded mb-2 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />

                {/* Enzyme list */}
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded p-2">
                  <div className="grid grid-cols-2 gap-1">
                    {restrictionEnzymes
                      .filter(enzyme =>
                        enzyme.name.toLowerCase().includes(enzymeSearchQuery.toLowerCase()) ||
                        enzyme.site.toLowerCase().includes(enzymeSearchQuery.toLowerCase())
                      )
                      .map(enzyme => (
                        <label key={enzyme.name} className="flex items-center space-x-1 text-xs">
                          <input
                            type="checkbox"
                            checked={selectedEnzymes.includes(enzyme.name)}
                            onChange={() => {
                              if (selectedEnzymes.includes(enzyme.name)) {
                                setSelectedEnzymes(selectedEnzymes.filter(e => e !== enzyme.name));
                              } else {
                                setSelectedEnzymes([...selectedEnzymes, enzyme.name]);
                              }
                            }}
                            className="w-3 h-3"
                          />
                          <span>{enzyme.name}</span>
                          <span className="text-gray-400">({enzyme.site})</span>
                        </label>
                      ))}
                  </div>
                  {restrictionEnzymes.filter(enzyme =>
                    enzyme.name.toLowerCase().includes(enzymeSearchQuery.toLowerCase()) ||
                    enzyme.site.toLowerCase().includes(enzymeSearchQuery.toLowerCase())
                  ).length === 0 && (
                    <div className="text-xs text-gray-400 text-center py-2">No enzymes found</div>
                  )}
                </div>
              </div>
            </details>

            {/* Show/hide toggle and count */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowRestrictionSites(!showRestrictionSites)}
                disabled={restrictionSites.length === 0}
                className={`px-3 py-1 text-sm rounded ${
                  showRestrictionSites
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-purple-700 border border-purple-300'
                } disabled:opacity-50`}
              >
                {showRestrictionSites ? 'Hide Sites' : 'Show Sites'}
              </button>
              <span className="text-xs text-gray-600">
                {restrictionSites.length} site{restrictionSites.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Found sites list */}
            {restrictionSites.length > 0 && (
              <div className="mt-2 max-h-32 overflow-y-auto border border-gray-200 rounded p-2 bg-gray-50">
                {restrictionSites.map((site, idx) => (
                  <div key={idx} className="text-xs py-1 border-b border-gray-200 last:border-0">
                    <span className="font-medium text-purple-700">{site.enzyme}</span>
                    <span className="text-gray-600"> @ pos {site.position + 1}</span>
                    {site.pattern !== site.site && (
                      <div className="text-[10px] text-gray-500 ml-1 mt-0.5">
                        {site.pattern} → {site.site}
                      </div>
                    )}
                    {!site.pattern && (
                      <span className="text-gray-500 text-[10px] ml-1">({site.site})</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ORF Finder */}
          <div className="mb-4 pb-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Open Reading Frames</h4>

            {/* Frame selection */}
            <div className="mb-2">
              <p className="text-xs text-gray-500 mb-2">Frames:</p>
              <div className="flex flex-wrap gap-1">
                {['+1', '+2', '+3', '-1', '-2', '-3'].map(frame => (
                  <button
                    key={frame}
                    onClick={() => {
                      if (selectedFrames.includes(frame)) {
                        setSelectedFrames(selectedFrames.filter(f => f !== frame));
                      } else {
                        setSelectedFrames([...selectedFrames, frame]);
                      }
                    }}
                    className={`px-2 py-1 text-xs rounded ${
                      selectedFrames.includes(frame)
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {frame}
                  </button>
                ))}
              </div>
            </div>

            {/* Min length slider */}
            <div className="mb-2">
              <label className="text-xs text-gray-600 flex justify-between">
                <span>Min Length:</span>
                <span className="font-medium">{minORFLength} bp (~{Math.floor(minORFLength / 3)} aa)</span>
              </label>
              <input
                type="range"
                min="30"
                max="300"
                step="30"
                value={minORFLength}
                onChange={(e) => setMinORFLength(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Show/hide toggle and count */}
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setShowORFs(!showORFs)}
                disabled={detectedORFs.length === 0}
                className={`px-3 py-1 text-sm rounded ${
                  showORFs
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-indigo-700 border border-indigo-300'
                } disabled:opacity-50`}
              >
                {showORFs ? 'Hide ORFs' : 'Show ORFs'}
              </button>
              <span className="text-xs text-gray-600">
                {detectedORFs.length} ORF{detectedORFs.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Found ORFs list */}
            {detectedORFs.length > 0 && (
              <div className="max-h-40 overflow-y-auto border border-gray-200 rounded p-2 bg-gray-50">
                {detectedORFs.map((orf, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedORF(selectedORF === idx ? null : idx)}
                    className={`text-xs py-1 px-2 mb-1 border-b border-gray-200 last:border-0 cursor-pointer rounded ${
                      selectedORF === idx ? 'bg-indigo-100' : 'hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex justify-between">
                      <span className="font-medium text-indigo-700">{orf.frame}</span>
                      <span className="text-gray-600">{orf.lengthAA} aa</span>
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {orf.start + 1}..{orf.end + 1} ({orf.length} bp)
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <button
              onClick={() => setShowReverseComplement(!showReverseComplement)}
              className={`w-full px-3 py-2 text-sm rounded hover:opacity-90 flex items-center justify-center space-x-2 ${
                showReverseComplement
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-blue-700 border-2 border-blue-600'
              }`}
            >
              <Repeat2 className="w-4 h-4" />
              <span>{showReverseComplement ? 'Show Forward' : 'Reverse Complement'}</span>
            </button>
            <button
              onClick={exportSequence}
              className="w-full px-3 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 flex items-center justify-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>Export FASTA</span>
            </button>
            <button
              onClick={resetView}
              className="w-full px-3 py-2 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 flex items-center justify-center space-x-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reset View</span>
            </button>

            {/* BLAST Actions */}
            <div className="border-t border-gray-300 pt-2 mt-2">
              <p className="text-xs text-gray-500 mb-2 font-semibold">BLAST Analysis</p>

              <button
                onClick={() => {
                  if (selectionRange) {
                    const displayData = showReverseComplement ? getReverseComplementData(parsedData) : parsedData;
                    const sequence = displayData.baseCalls.slice(selectionRange.start, selectionRange.end + 1).join('');
                    const label = `${fileName}_region_${selectionRange.start + 1}-${selectionRange.end + 1}`;
                    openBLAST(sequence, label);
                  }
                }}
                disabled={selectionRange === null}
                className="w-full px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed mb-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
                <span>BLAST Selected Region</span>
              </button>

              <button
                onClick={() => {
                  if (selectedORF !== null && detectedORFs[selectedORF]) {
                    const orf = detectedORFs[selectedORF];
                    const proteinSequence = orf.aminoAcids;
                    const label = `${fileName}_ORF_${orf.frame}_${orf.start + 1}-${orf.end + 1}`;
                    openBLAST(proteinSequence, label, true);
                  }
                }}
                disabled={selectedORF === null}
                className="w-full px-3 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed mb-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
                <span>BLASTp Selected ORF</span>
              </button>

              <button
                onClick={() => {
                  const displayData = showReverseComplement ? getReverseComplementData(parsedData) : parsedData;
                  const sequence = displayData.sequence;
                  const suffix = showReverseComplement ? '_reverse_complement' : '';
                  const label = `${fileName}${suffix}`;
                  openBLAST(sequence, label);
                }}
                className="w-full px-3 py-2 bg-teal-600 text-white text-sm rounded hover:bg-teal-700 flex items-center justify-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
                <span>BLAST Full Sequence</span>
              </button>
            </div>

            {onClose && (
              <button
                onClick={onClose}
                className="w-full px-3 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 flex items-center justify-center space-x-2"
              >
                <X className="w-4 h-4" />
                <span>Close</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 flex flex-col relative">
        {/* Menu Toggle Button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute top-1 left-1 z-10 p-2 bg-teal-600 text-white rounded-lg shadow-lg hover:bg-teal-700"
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        {/* Layout Mode Toggle and Zoom Controls */}
        <div className="absolute top-1 left-14 z-10 bg-white rounded-lg shadow-lg px-3 py-2 flex items-center space-x-4">
          {/* Layout Toggle */}
          <div className="flex items-center space-x-2">
            <span className="text-xs font-medium text-gray-700">Layout:</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={layoutMode === 'wrapped'}
                onChange={() => setLayoutMode(layoutMode === 'horizontal' ? 'wrapped' : 'horizontal')}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-teal-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
            </label>
            <span className="text-xs font-medium text-gray-700">
              {layoutMode === 'horizontal' ? 'Scroll' : 'Wrap'}
            </span>
          </div>

          {/* Divider */}
          <div className="h-6 w-px bg-gray-300"></div>

          {/* Zoom Controls */}
          <div className="flex items-center space-x-2">
            <span className="text-xs font-medium text-gray-700">Zoom:</span>
            <button
              onClick={() => handleZoom(-0.5)}
              className="p-1 border border-gray-300 rounded hover:bg-gray-100"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[3rem] text-center">
              {zoomLevel.toFixed(1)}x
            </span>
            <button
              onClick={() => handleZoom(0.5)}
              className="p-1 border border-gray-300 rounded hover:bg-gray-100"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          {/* Divider */}
          <div className="h-6 w-px bg-gray-300"></div>

          {/* Sequence Search */}
          <div className="flex items-center space-x-2">
            <span className="text-xs font-medium text-gray-700">Search:</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value.toUpperCase())}
              placeholder="ATGC, IUPAC..."
              className="px-2 py-1 text-xs border border-gray-300 rounded w-32 uppercase"
            />
            {searchMatches.length > 0 && (
              <>
                <span className="text-xs text-gray-600">
                  {currentMatchIndex + 1}/{searchMatches.length}
                </span>
                <button
                  onClick={() => {
                    const newIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
                    setCurrentMatchIndex(newIndex);
                  }}
                  className="p-1 border border-gray-300 rounded hover:bg-gray-100 text-xs"
                  title="Previous match"
                >
                  ◀
                </button>
                <button
                  onClick={() => {
                    const newIndex = (currentMatchIndex + 1) % searchMatches.length;
                    setCurrentMatchIndex(newIndex);
                  }}
                  className="p-1 border border-gray-300 rounded hover:bg-gray-100 text-xs"
                  title="Next match"
                >
                  ▶
                </button>
              </>
            )}
          </div>
        </div>

        {/* Canvas - adjusted padding to not overlap with scrollbar */}
        <div className={`absolute top-0 left-0 right-0 ${layoutMode === 'horizontal' ? 'bottom-10' : 'bottom-0'} p-1 pt-12 ${layoutMode === 'wrapped' ? 'overflow-y-auto' : ''}`}>
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onDoubleClick={handleNavigation}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={() => {
              handleCanvasMouseLeave();
              // Cancel drag if mouse leaves canvas
              if (isDragging) {
                setIsDragging(false);
                setDragStartPosition(null);
                stopAutoScroll();
              }
            }}
            className={`w-full border border-gray-200 rounded ${layoutMode === 'horizontal' ? 'h-full' : ''}`}
            style={{
              touchAction: layoutMode === 'wrapped' ? 'auto' : 'none',
              display: 'block',
              willChange: 'contents',
              cursor: isDragging ? 'text' : 'pointer'
            }}
          />
        </div>

        {/* Bottom Scrollbar - only show in horizontal mode */}
        {layoutMode === 'horizontal' && (
        <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 py-1">
          <div className="flex items-center space-x-2">
            <input
              type="range"
              min="0"
              max="10000"
              value={((touchState.current.isActive || inertiaState.current.isActive) ? scrollOffsetRef.current : scrollPosition) * 10000}
              onChange={handleScrollbarChange}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #0d9488 0%, #0d9488 ${((touchState.current.isActive || inertiaState.current.isActive) ? scrollOffsetRef.current : scrollPosition) * 100}%, #E5E7EB ${((touchState.current.isActive || inertiaState.current.isActive) ? scrollOffsetRef.current : scrollPosition) * 100}%, #E5E7EB 100%)`
              }}
            />
            <span className="text-xs text-gray-600 whitespace-nowrap">
              {(() => {
                if (!canvasRef.current || !parsedData || !parsedData.traces) return '0-0';

                try {
                  const traceLengths = Object.values(parsedData.traces).map(trace => trace.length);
                  const maxTraceLength = Math.max(...traceLengths);
                  if (maxTraceLength === 0) return '0-0';

                  const dataLength = maxTraceLength;
                  const canvasWidth = canvasRef.current.width || 1200;
                  const visiblePoints = Math.floor(canvasWidth / zoomLevel);
                  const startIndex = Math.floor(scrollPosition * (dataLength - visiblePoints));
                  const endIndex = Math.min(startIndex + visiblePoints, dataLength);

                  const startBasePos = Math.floor(startIndex * parsedData.baseCalls.length / maxTraceLength);
                  const endBasePos = Math.floor(endIndex * parsedData.baseCalls.length / maxTraceLength);

                  return `${startBasePos + 1}-${Math.min(endBasePos, parsedData.baseCalls.length)}`;
                } catch (error) {
                  return '0-0';
                }
              })()}
            </span>
          </div>
        </div>
        )}
      </div>
    </div>
  );
};

export default ChromatogramViewer;