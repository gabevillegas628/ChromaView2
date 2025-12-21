# ChromaViewer

A standalone mobile app for viewing and analyzing chromatogram files (AB1 and SCF formats).

## Features

- 📊 View AB1 and SCF chromatogram files
- 🔍 Zoom and pan through chromatogram data
- 🎨 Toggle individual nucleotide channels (A, T, G, C)
- ✏️ Edit base calls with visual confirmation
- 📱 Native mobile support (Android & iOS)
- 💻 Also runs in web browsers
- 📥 Export sequences to FASTA format

## Project Structure

```
ChromaViewer/
├── src/
│   ├── components/
│   │   └── ChromatogramViewer.jsx    # Main chromatogram viewer component
│   ├── App.jsx                        # Main app with file picker
│   ├── main.jsx                       # React entry point
│   └── index.css                      # Global styles with Tailwind
├── index.html                         # HTML entry point
├── package.json                       # Dependencies and scripts
├── vite.config.js                     # Vite build configuration
├── tailwind.config.js                 # TailwindCSS configuration
├── capacitor.config.json              # Capacitor configuration
└── README.md                          # This file
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run in Browser (Development)

```bash
npm run dev
```

This will start a development server at `http://localhost:3000`

### 3. Build for Production

```bash
npm run build
```

## Mobile App Setup

### Prerequisites

- **Node.js** (v18 or higher)
- **Android Studio** (for Android)
- **Xcode** (for iOS, macOS only)

### Initialize Capacitor

If this is your first time setting up the mobile apps:

```bash
# Initialize Capacitor (only needed once)
npm run cap:init

# Add platforms
npx cap add android
npx cap add ios
```

### Build and Deploy to Mobile

#### Android

```bash
# Build the web app and sync to Android
npm run build:mobile

# Open in Android Studio
npm run cap:android

# In Android Studio:
# 1. Wait for Gradle sync to complete
# 2. Connect your device or start an emulator
# 3. Click Run ▶️
```

#### iOS

```bash
# Build the web app and sync to iOS
npm run build:mobile

# Open in Xcode
npm run cap:ios

# In Xcode:
# 1. Select your team for code signing
# 2. Connect your device or select a simulator
# 3. Click Run ▶️
```

## Development Workflow

### Web Development

```bash
# Start dev server with hot reload
npm run dev
```

### Mobile Development

```bash
# After making changes to web code:
npm run build:mobile

# Then rerun the app from Android Studio or Xcode
```

### Syncing Changes

Whenever you update Capacitor plugins or configuration:

```bash
npm run cap:sync
```

## Usage

1. **Launch the app**
2. **Tap "Select Chromatogram File"**
3. **Choose an AB1 or SCF file**
4. **View and interact with the chromatogram:**
   - Pinch to zoom
   - Swipe to scroll
   - Tap a base to select it
   - Press A/T/G/C/N keys to edit the selected base
   - Use the highlight feature to select regions
   - Export to FASTA format

## Supported File Formats

- **AB1** - Applied Biosystems sequencer format
- **SCF** - Standard Chromatogram Format

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build web app for production |
| `npm run preview` | Preview production build |
| `npm run cap:init` | Initialize Capacitor (first time only) |
| `npm run cap:sync` | Sync web code to native platforms |
| `npm run cap:android` | Open Android project in Android Studio |
| `npm run cap:ios` | Open iOS project in Xcode |
| `npm run build:mobile` | Build web app and sync to native platforms |

## Technologies

- **React** - UI framework
- **Vite** - Build tool and dev server
- **TailwindCSS** - Utility-first CSS framework
- **Capacitor** - Native mobile runtime
- **Lucide React** - Icon library

## Troubleshooting

### Android Build Issues

1. Make sure Android Studio is installed with SDK 33 or higher
2. Set `ANDROID_HOME` environment variable
3. Accept Android SDK licenses: `sdkmanager --licenses`

### iOS Build Issues

1. Make sure Xcode is installed (macOS only)
2. Install CocoaPods: `sudo gem install cocoapods`
3. Run `pod install` in the `ios/App` directory

### File Loading Issues

- Ensure files are valid AB1 or SCF format
- Check browser console for detailed error messages
- Large files may take a few seconds to load

## License

MIT

## Version

1.0.0
