import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Download, Eye, EyeOff, Menu, X } from 'lucide-react';

const ChromatogramViewer = ({ fileData, fileName, onClose, isResizing = false }) => {
  console.log('ChromatogramViewer props:', { fileData, fileName }); // Debug log
  const canvasRef = useRef(null);

  // Touch scrolling refs
  const isTouchScrolling = useRef(false);
  const touchStartX = useRef(0);
  const touchStartScrollPos = useRef(0);
  const rafPendingScroll = useRef(false);
  const latestTouchX = useRef(0);
  const previousTouchX = useRef(0);

  // Inertial scrolling refs
  const velocityX = useRef(0);
  const lastTouchTime = useRef(0);
  const inertiaAnimationFrame = useRef(null);
  const lastInertiaTime = useRef(0);
  const touchHistory = useRef([]);
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

  // Add state for highligting regions
  const [highlightStart, setHighlightStart] = useState('');
  const [highlightEnd, setHighlightEnd] = useState('');
  const [showHighlight, setShowHighlight] = useState(false);

  // Add state for editing
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [editedPositions, setEditedPositions] = useState(new Set());

  // Add state for confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingEdit, setPendingEdit] = useState(null); // {position, oldBase, newBase}

  // Sidebar visibility for mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);


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
      const timer = setTimeout(() => {
        drawChromatogram();
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [parsedData, zoomLevel, scrollPosition, showChannels, qualityThreshold, selectedPosition, hoveredPosition, isEditing]);

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

  // Add this useEffect for wheel event handling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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
  }, [parsedData]); // Only re-attach when parsedData changes, not on every scroll

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
  }, [parsedData, zoomLevel, scrollPosition, showChannels, isResizing]); // Redraw when these change

  // Ensure a final clean redraw when resize completes
  useEffect(() => {
    if (!isResizing && parsedData) {
      // Small delay to ensure final size is set
      setTimeout(() => {
        drawChromatogram();
      }, 50);
    }
  }, [isResizing, parsedData]);

  // Inertial scrolling animation
  const startInertiaAnimation = useCallback(() => {
    if (!parsedData) return;

    lastInertiaTime.current = performance.now();

    const inertiaStep = () => {
      const currentTime = performance.now();
      const deltaTime = currentTime - lastInertiaTime.current;
      lastInertiaTime.current = currentTime;

      // Apply friction/deceleration (exponential decay)
      const FRICTION_FACTOR = 0.99; // Adjust for feel (0.90-0.98 typical)
      velocityX.current *= Math.pow(FRICTION_FACTOR, deltaTime / 16); // Normalize to ~60fps

      // Stop if velocity is too small
      const STOP_THRESHOLD = 0.01; // pixels/ms
      if (Math.abs(velocityX.current) < STOP_THRESHOLD) {
        inertiaAnimationFrame.current = null;
        return; // Stop animation
      }

      // Calculate scroll delta from velocity
      const canvas = canvasRef.current;
      if (!canvas) return;

      const traceLengths = Object.values(parsedData.traces).map(trace => trace.length);
      const dataLength = Math.max(...traceLengths);
      const visiblePoints = Math.floor(canvas.width / zoomLevel);
      const scrollableRange = dataLength - visiblePoints;

      if (scrollableRange <= 0) return;

      // Convert velocity to scroll delta
      const pixelsMoved = velocityX.current * deltaTime;
      const scrollDelta = (pixelsMoved / canvas.width) * (visiblePoints / scrollableRange);

      // Update scroll position
      setScrollPosition(prev => {
        const newPos = prev + scrollDelta;

        // Check boundaries
        if (newPos <= 0 || newPos >= 1) {
          // Hit boundary - stop inertia
          inertiaAnimationFrame.current = null;
          return Math.max(0, Math.min(1, newPos));
        }

        return newPos;
      });

      // Continue animation
      inertiaAnimationFrame.current = requestAnimationFrame(inertiaStep);
    };

    inertiaAnimationFrame.current = requestAnimationFrame(inertiaStep);
  }, [parsedData, zoomLevel]);

  // Touch scrolling handlers with RAF throttling
  const handleCanvasTouchStart = useCallback((e) => {
    e.stopPropagation(); // Prevent event from bubbling to parent elements

    // Cancel any ongoing inertia animation
    if (inertiaAnimationFrame.current !== null) {
      cancelAnimationFrame(inertiaAnimationFrame.current);
      inertiaAnimationFrame.current = null;
    }

    // Reset velocity and touch history
    velocityX.current = 0;
    touchHistory.current = [];

    if (e.touches.length === 1) {
      touchStartX.current = e.touches[0].clientX;
      touchStartScrollPos.current = scrollPosition;
      previousTouchX.current = e.touches[0].clientX; // Initialize for 1:1 dragging
      lastTouchTime.current = performance.now(); // Initialize timestamp
      isTouchScrolling.current = true;
    }
  }, [scrollPosition]);

  const handleCanvasTouchMove = useCallback((e) => {
    e.preventDefault(); // Prevent page scrolling - ALWAYS, before any checks
    e.stopPropagation(); // Prevent event from bubbling to parent elements

    if (!isTouchScrolling.current || e.touches.length !== 1) return;

    const canvas = canvasRef.current;
    if (!canvas || !parsedData) return;

    // Store latest touch position and timestamp
    latestTouchX.current = e.touches[0].clientX;
    const currentTime = performance.now();

    // Only schedule one RAF at a time to prevent flooding
    if (!rafPendingScroll.current) {
      rafPendingScroll.current = true;

      requestAnimationFrame(() => {
        rafPendingScroll.current = false;

        if (!canvas || !parsedData) return;

        // Calculate incremental pixel movement from previous frame (not from start)
        const pixelsMoved = previousTouchX.current - latestTouchX.current;

        // Track velocity for inertial scrolling
        const timeDelta = currentTime - lastTouchTime.current;
        if (timeDelta > 0) {
          const instantVelocity = pixelsMoved / timeDelta; // pixels/ms

          // Add to touch history for averaging
          touchHistory.current.push({
            velocity: instantVelocity,
            time: currentTime
          });

          // Keep only recent history (last 5 touch points)
          const TOUCH_HISTORY_LENGTH = 5;
          if (touchHistory.current.length > TOUCH_HISTORY_LENGTH) {
            touchHistory.current.shift();
          }
        }

        lastTouchTime.current = currentTime;

        // Get data dimensions for 1:1 mapping
        const traceLengths = Object.values(parsedData.traces).map(trace => trace.length);
        const dataLength = Math.max(...traceLengths);
        const visiblePoints = Math.floor(canvas.width / zoomLevel);
        const scrollableRange = dataLength - visiblePoints;

        if (scrollableRange <= 0) return; // No scrolling needed if all data fits

        // Convert pixel movement to scroll position change (1:1 direct manipulation)
        // Moving finger one canvas width = scrolling one canvas width of data
        const scrollDelta = (pixelsMoved / canvas.width) * (visiblePoints / scrollableRange);

        // Update from CURRENT position (not from touch start position)
        setScrollPosition(prev => Math.max(0, Math.min(1, prev + scrollDelta)));

        // Update previous position for next frame
        previousTouchX.current = latestTouchX.current;
      });
    }
  }, [parsedData, zoomLevel]);

  const handleCanvasTouchEnd = useCallback((e) => {
    e.stopPropagation(); // Prevent event from bubbling to parent elements
    isTouchScrolling.current = false;
    previousTouchX.current = 0; // Reset for next touch interaction

    // Calculate average velocity from recent history for inertial scrolling
    if (touchHistory.current.length >= 2) {
      // Filter out entries older than 100ms to avoid stale data
      const now = performance.now();
      const recentHistory = touchHistory.current.filter(
        entry => now - entry.time < 100
      );

      if (recentHistory.length >= 2) {
        // Use weighted average (recent touches matter more)
        let totalVelocity = 0;
        let totalWeight = 0;

        recentHistory.forEach((entry, index) => {
          const weight = index + 1; // More recent = higher weight
          totalVelocity += entry.velocity * weight;
          totalWeight += weight;
        });

        velocityX.current = totalVelocity / totalWeight;

        // Cap maximum velocity to prevent unrealistic scroll speeds
        const MAX_VELOCITY = 2.0; // pixels/ms
        velocityX.current = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, velocityX.current));

        // Only start inertia if velocity is significant
        const MIN_VELOCITY_THRESHOLD = 0.1; // pixels/ms
        if (Math.abs(velocityX.current) > MIN_VELOCITY_THRESHOLD) {
          startInertiaAnimation();
        }
      }
    }

    // Clear touch history for next interaction
    touchHistory.current = [];
  }, [startInertiaAnimation]);

  // Add touch scrolling to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !parsedData) return;

    canvas.addEventListener('touchstart', handleCanvasTouchStart);
    canvas.addEventListener('touchmove', handleCanvasTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleCanvasTouchEnd);

    return () => {
      canvas.removeEventListener('touchstart', handleCanvasTouchStart);
      canvas.removeEventListener('touchmove', handleCanvasTouchMove);
      canvas.removeEventListener('touchend', handleCanvasTouchEnd);
    };
  }, [parsedData, handleCanvasTouchStart, handleCanvasTouchMove, handleCanvasTouchEnd]);

  // Cleanup inertia animation on component unmount
  useEffect(() => {
    return () => {
      if (inertiaAnimationFrame.current !== null) {
        cancelAnimationFrame(inertiaAnimationFrame.current);
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

  const drawChromatogram = () => {
    const canvas = canvasRef.current;
    if (!canvas || !parsedData) return;

    const ctx = canvas.getContext('2d');
    const { traces, quality, baseCalls } = parsedData;

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
      canvas.width = container.offsetWidth || 1200;
      canvas.height = container.offsetHeight || 300;
    } else {
      // Fallback to larger default sizes
      canvas.width = 1600;
      canvas.height = 300;
    }

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate visible range
    const dataLength = maxTraceLength;
    const visiblePoints = Math.floor(canvas.width / zoomLevel);
    const startIndex = Math.floor(scrollPosition * (dataLength - visiblePoints));
    const endIndex = Math.min(startIndex + visiblePoints, dataLength);

    // Find the maximum value in the visible range for normalization
    let maxValue = 0;
    Object.values(traces).forEach(trace => {
      for (let i = startIndex; i < endIndex && i < trace.length; i++) {
        maxValue = Math.max(maxValue, trace[i]);
      }
    });

    // Prevent division by zero
    if (maxValue === 0) maxValue = 1;

    // Draw chromatogram traces with normalization
    const colors = {
      A: '#00AA00', // Green
      T: '#FF0000', // Red
      G: '#000000', // Black
      C: '#0000FF'  // Blue
    };

    // Dynamic layout based on canvas height
    const baseCallHeight = 30;  // Space for base call letters at top
    const bottomReserve = 50;   // Space for quality bars, tick marks, and position numbers
    const traceHeight = Math.max(100, canvas.height - baseCallHeight - bottomReserve); // Available height for traces
    const baselineY = baseCallHeight + traceHeight;

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
        // Normalize the y value to fit in available height
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


    // Draw base calls and quality (SINGLE LOOP ONLY)
    ctx.font = 'bold 16px monospace';

    const { peakLocations } = parsedData;

    for (let i = 0; i < baseCalls.length; i++) {
      // Use actual peak location or fallback to estimated position
      const peakPosition = peakLocations && peakLocations[i]
        ? peakLocations[i]
        : (i * maxTraceLength / baseCalls.length);

      // Check if this peak is in the visible range
      if (peakPosition < startIndex || peakPosition > endIndex) continue;

      const x = ((peakPosition - startIndex) / (endIndex - startIndex)) * canvas.width;
      const base = baseCalls[i];
      const qual = quality[i] || 0;

      // Only draw if position is visible
      if (x >= -20 && x <= canvas.width + 20) {
        // Highlight selected position
        if (selectedPosition === i) {
          ctx.fillStyle = '#FFD700';
          ctx.fillRect(x - 12, 5, 24, baseCallHeight - 5);
          ctx.strokeStyle = '#FF6600';
          ctx.lineWidth = 2;
          ctx.strokeRect(x - 12, 5, 24, baseCallHeight - 5);
        }

        // Highlight N bases with transparent red background
        if (base === 'N') {
          ctx.fillStyle = 'rgba(255, 0, 0, 0.3)'; // Transparent red
          ctx.fillRect(x - 12, 5, 24, baseCallHeight - 5);
          ctx.strokeStyle = '#FF0000'; // Red border
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 12, 5, 24, baseCallHeight - 5);
        }

        // Highlight edited positions with a different color
        if (editedPositions.has(i)) {
          ctx.fillStyle = 'rgba(128, 0, 255, 0.3)'; // Purple tint for edited bases
          ctx.fillRect(x - 12, 5, 24, baseCallHeight - 5);
          ctx.strokeStyle = '#8000FF';
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 12, 5, 24, baseCallHeight - 5);
        }

        // Always color base calls by their nucleotide type
        ctx.fillStyle = colors[base] || '#666666';

        // Draw base letter
        ctx.fillText(base, x - 6, baseCallHeight - 5);

        // Draw quality bar
        ctx.fillStyle = qual >= qualityThreshold ? colors[base] || '#666666' : '#CCCCCC';
        const barHeight = (qual / 60) * 12;
        ctx.fillRect(x - 2, baselineY + 5, 4, barHeight);  // Changed +20 to +5
      }
    }


    // Draw position markers at the bottom
    ctx.fillStyle = '#666666';
    ctx.font = '24px monospace';

    const positionInterval = zoomLevel > 10 ? 10 : zoomLevel > 5 ? 25 : 50;

    for (let pos = 0; pos < baseCalls.length; pos += positionInterval) {
      const peakPosition = peakLocations && peakLocations[pos]
        ? peakLocations[pos]
        : (pos * maxTraceLength / baseCalls.length);

      if (peakPosition < startIndex || peakPosition > endIndex) continue;

      const x = ((peakPosition - startIndex) / (endIndex - startIndex)) * canvas.width;

      if (x >= 0 && x <= canvas.width) {
        // Draw position number
        ctx.fillStyle = '#666666';
        ctx.fillText((pos + 1).toString(), x - 10, canvas.height - 5);  // Now shows 1-based positions

        // Draw tick mark
        ctx.strokeStyle = '#CCCCCC';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, baselineY + 20);  // Start just below quality bars
        ctx.lineTo(x, canvas.height - 15);  // End just above position numbers
        ctx.stroke();
      }
    }


    // Draw selected position highlight line
    if (selectedPosition !== null) {
      const { peakLocations } = parsedData;
      const peakPosition = peakLocations && peakLocations[selectedPosition]
        ? peakLocations[selectedPosition]
        : (selectedPosition * maxTraceLength / baseCalls.length);

      const selectedX = ((peakPosition - startIndex) / (endIndex - startIndex)) * canvas.width;
      if (selectedX >= 0 && selectedX <= canvas.width) {
        ctx.strokeStyle = '#FF6600';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(selectedX, baseCallHeight);
        ctx.lineTo(selectedX, baselineY + 20);  // End just below quality bars
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Draw hover highlight
    if (hoveredPosition !== null && hoveredPosition !== selectedPosition) {
      const { peakLocations } = parsedData;
      const peakPosition = peakLocations && peakLocations[hoveredPosition]
        ? peakLocations[hoveredPosition]
        : (hoveredPosition * maxTraceLength / baseCalls.length);

      const hoverX = ((peakPosition - startIndex) / (endIndex - startIndex)) * canvas.width;
      if (hoverX >= 0 && hoverX <= canvas.width) {
        ctx.fillStyle = 'rgba(173, 216, 230, 0.4)';
        ctx.fillRect(hoverX - 12, 5, 24, baselineY + 20 - 5);  // Height from top to below quality bars
      }
    }

    // Draw quality threshold line
    ctx.strokeStyle = '#FF6B6B';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    const thresholdY = baselineY + 20 + (qualityThreshold / 60) * 12;
    ctx.moveTo(0, thresholdY);
    ctx.lineTo(canvas.width, thresholdY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw scale info
    ctx.fillStyle = '#666666';
    ctx.font = '10px sans-serif';

    // Draw sequence highlight
    if (showHighlight && highlightStart && highlightEnd && parsedData) {
      const startPos = parseInt(highlightStart) - 1;
      const endPos = parseInt(highlightEnd) - 1;

      if (!isNaN(startPos) && !isNaN(endPos) && startPos >= 0 && endPos < baseCalls.length && startPos <= endPos) {
        const { peakLocations } = parsedData;

        // Get start and end positions
        const startPeakPosition = peakLocations && peakLocations[startPos]
          ? peakLocations[startPos]
          : (startPos * maxTraceLength / baseCalls.length);
        const endPeakPosition = peakLocations && peakLocations[endPos]
          ? peakLocations[endPos]
          : (endPos * maxTraceLength / baseCalls.length);

        // Check if highlight is in visible range
        if (endPeakPosition >= startIndex && startPeakPosition <= endIndex) {
          const startX = Math.max(0, ((startPeakPosition - startIndex) / (endIndex - startIndex)) * canvas.width);
          const endX = Math.min(canvas.width, ((endPeakPosition - startIndex) / (endIndex - startIndex)) * canvas.width);

          // Draw highlight background
          ctx.fillStyle = 'rgba(255, 255, 0, 0.3)'; // Yellow with transparency
          ctx.fillRect(startX - 12, 5, endX - startX + 24, baselineY + 20 - 5);

          // Draw highlight borders
          ctx.strokeStyle = '#FFD700';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(startX, 5);
          ctx.lineTo(startX, baselineY + 20);
          ctx.moveTo(endX, 5);
          ctx.lineTo(endX, baselineY + 20);
          ctx.stroke();
        }
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

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    console.log('Click at canvas X:', canvasX, 'Y:', canvasY);

    // Calculate visible range
    const traceLengths = Object.values(parsedData.traces).map(trace => trace.length);
    const maxTraceLength = Math.max(...traceLengths);
    const dataLength = maxTraceLength;
    const visiblePoints = Math.floor(canvas.width / zoomLevel);
    const startIndex = Math.floor(scrollPosition * (dataLength - visiblePoints));
    const endIndex = Math.min(startIndex + visiblePoints, dataLength);

    console.log('Visible range:', startIndex, 'to', endIndex);

    // Calculate the actual ratio for real data
    const dataPointsPerBase = maxTraceLength / parsedData.baseCalls.length;

    // Find the closest base call position
    let closestPosition = null;
    let closestDistance = Infinity;

    for (let i = 0; i < parsedData.baseCalls.length; i++) {
      const peakPosition = parsedData.peakLocations && parsedData.peakLocations[i]
        ? parsedData.peakLocations[i]
        : (i * maxTraceLength / parsedData.baseCalls.length);

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
      const nucleotide = parsedData.baseCalls[closestPosition];
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
    if (!parsedData) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.width / rect.width;
    const canvasX = (e.clientX - rect.left) * scaleX;

    // Calculate visible range
    const traceLengths = Object.values(parsedData.traces).map(trace => trace.length);
    const maxTraceLength = Math.max(...traceLengths);
    const dataLength = maxTraceLength;
    const visiblePoints = Math.floor(canvas.width / zoomLevel);
    const startIndex = Math.floor(scrollPosition * (dataLength - visiblePoints));
    const endIndex = Math.min(startIndex + visiblePoints, dataLength);

    // Calculate the actual ratio for real data
    const dataPointsPerBase = maxTraceLength / parsedData.baseCalls.length;

    // Find closest position
    let closestPosition = null;
    let closestDistance = Infinity;

    for (let i = 0; i < parsedData.baseCalls.length; i++) {
      const peakPosition = parsedData.peakLocations && parsedData.peakLocations[i]
        ? parsedData.peakLocations[i]
        : (i * maxTraceLength / parsedData.baseCalls.length);

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

  const handleScrollbarChange = (e) => {
    const newPosition = parseFloat(e.target.value) / 10000;
    setScrollPosition(newPosition);
  };

  const resetView = () => {
    setZoomLevel(2.5);
    setScrollPosition(0);
    // Clear selection when resetting view
    setSelectedPosition(null);
    setSelectedNucleotide(null);
  };

  const toggleChannel = (channel) => {
    setShowChannels(prev => ({
      ...prev,
      [channel]: !prev[channel]
    }));
  };

  const exportSequence = () => {
    if (!parsedData) return;

    const fasta = `>${fileName}\n${parsedData.sequence}`;
    const blob = new Blob([fasta], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace('.ab1', '')}.fasta`;
    a.click();
    URL.revokeObjectURL(url);
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

          {/* Zoom Controls */}
          <div className="mb-4 pb-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Zoom</h4>
            <div className="flex items-center justify-center space-x-3">
              <button
                onClick={() => handleZoom(-0.5)}
                className="p-2 border border-gray-300 rounded hover:bg-gray-100"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
              <span className="text-lg font-medium text-gray-700 min-w-[4rem] text-center">
                {zoomLevel.toFixed(1)}x
              </span>
              <button
                onClick={() => handleZoom(0.5)}
                className="p-2 border border-gray-300 rounded hover:bg-gray-100"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
            </div>
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

          {/* Highlight Region */}
          <div className="mb-4 pb-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Highlight Region</h4>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  value={highlightStart}
                  onChange={(e) => setHighlightStart(e.target.value)}
                  placeholder="Start"
                  min="1"
                  max={parsedData?.sequenceLength - 1 || 0}
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                />
                <span className="text-sm text-gray-500">to</span>
                <input
                  type="number"
                  value={highlightEnd}
                  onChange={(e) => setHighlightEnd(e.target.value)}
                  placeholder="End"
                  min="0"
                  max={parsedData?.sequenceLength || 1}
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                />
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setShowHighlight(!showHighlight)}
                  disabled={!highlightStart || !highlightEnd}
                  className={`flex-1 px-2 py-1 text-sm rounded ${showHighlight
                    ? 'bg-yellow-600 text-white'
                    : 'bg-white text-yellow-700 border border-yellow-300'
                    } disabled:opacity-50`}
                >
                  {showHighlight ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={() => {
                    if (highlightStart && highlightEnd && parsedData) {
                      const startPos = parseInt(highlightStart) - 1;
                      const endPos = parseInt(highlightEnd) - 1;
                      if (!isNaN(startPos) && !isNaN(endPos) && startPos >= 0 && endPos < parsedData.baseCalls.length && startPos <= endPos) {
                        const sequence = parsedData.baseCalls.slice(startPos, endPos + 1).join('');
                        navigator.clipboard.writeText(sequence);
                      }
                    }
                  }}
                  disabled={!highlightStart || !highlightEnd}
                  className="flex-1 px-2 py-1 bg-green-600 text-white text-sm rounded disabled:opacity-50"
                >
                  Copy
                </button>
              </div>
              {highlightStart && highlightEnd && parsedData && (() => {
                const startPos = parseInt(highlightStart) - 1;
                const endPos = parseInt(highlightEnd) - 1;
                if (!isNaN(startPos) && !isNaN(endPos) && startPos >= 0 && endPos < parsedData.baseCalls.length && startPos <= endPos) {
                  return (
                    <p className="text-xs text-gray-600 text-center">
                      {endPos - startPos + 1} bases
                    </p>
                  );
                }
              })()}
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
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

        {/* Canvas - adjusted padding to not overlap with scrollbar */}
        <div className="absolute top-0 left-0 right-0 bottom-10 p-1 pt-12">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onDoubleClick={handleNavigation}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={handleCanvasMouseLeave}
            className="w-full h-full border border-gray-200 rounded cursor-pointer"
            style={{ touchAction: 'none' }}
          />
        </div>

        {/* Bottom Scrollbar */}
        <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 py-1">
          <div className="flex items-center space-x-2">
            <input
              type="range"
              min="0"
              max="10000"
              value={scrollPosition * 10000}
              onChange={handleScrollbarChange}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #0d9488 0%, #0d9488 ${scrollPosition * 100}%, #E5E7EB ${scrollPosition * 100}%, #E5E7EB 100%)`
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
      </div>
    </div>
  );
};

export default ChromatogramViewer;