# Apple App Store Publishing Guide for ChromaViewer

## Overview
This guide will help you publish ChromaViewer to the Apple App Store. The process is generally more straightforward than Google Play, though it requires a Mac for the final build steps.

## Prerequisites

### 1. Apple Developer Account
- **Cost**: $99 USD/year
- **Sign up**: https://developer.apple.com/programs/enroll/
- **Requirements**:
  - Apple ID
  - Valid payment method
  - Two-factor authentication enabled
- **Timeline**: Approval usually takes 24-48 hours

### 2. Hardware/Software Requirements
- **Mac computer** (required for Xcode and app submission)
- **Xcode** (latest version from Mac App Store)
- **iOS device** for testing (optional but recommended)

---

## Step 1: Prepare App Icons and Screenshots

### App Icons
Your app already has icons in `ios/App/App/Assets.xcassets/AppIcon.appiconset/`

**Required icon sizes for iOS:**
- 1024x1024 (App Store)
- 180x180 (iPhone)
- 167x167 (iPad Pro)
- 152x152 (iPad)
- 120x120 (iPhone)
- 87x87 (iPhone)
- 80x80 (iPad)
- 76x76 (iPad)
- 60x60 (iPhone)
- 58x58 (iPhone/iPad)
- 40x40 (iPhone/iPad)
- 29x29 (iPhone/iPad)

### Screenshots (Required for App Store Listing)
You'll need screenshots for various device sizes:

**iPhone (required):**
- 6.7" Display (1290 x 2796 pixels) - iPhone 15 Pro Max
- 6.5" Display (1242 x 2688 pixels) - iPhone 11 Pro Max
- OR 5.5" Display (1242 x 2208 pixels) - iPhone 8 Plus

**iPad (if supporting iPad):**
- 12.9" Display (2048 x 2732 pixels) - iPad Pro

**Tip**: Take 3-5 screenshots showing your app's main features

---

## Step 2: Configure App Metadata

### Update Info.plist (if needed)
Location: `ios/App/App/Info.plist`

**Key items to verify:**
```xml
<key>CFBundleDisplayName</key>
<string>ChromaViewer</string>
```

### Privacy Settings
Since your app uses the Filesystem API, you may need to add privacy descriptions:

```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>ChromaViewer needs access to your photo library to import chromatogram files (AB1/SCF).</string>

<key>NSDocumentsFolderUsageDescription</key>
<string>ChromaViewer needs access to your documents to open chromatogram files.</string>
```

---

## Step 3: Build and Archive Your App

### On Your Mac:

1. **Sync your latest code**
   ```bash
   npm run build:mobile
   ```

2. **Open Xcode**
   ```bash
   npm run cap:ios
   ```
   Or manually: Open `ios/App/App.xcworkspace` in Xcode

3. **Select "Any iOS Device" as build target**
   - Click on the device selector in toolbar
   - Choose "Any iOS Device (arm64)"

4. **Set Version and Build Number**
   - Select the "App" project in left sidebar
   - Select "App" target
   - General tab
   - Set Version (e.g., "1.0.0")
   - Set Build number (e.g., "1")

5. **Archive the app**
   - Menu: Product → Archive
   - Wait for build to complete (may take several minutes)
   - Archives window will open automatically

6. **Distribute to App Store**
   - Click "Distribute App"
   - Select "App Store Connect"
   - Click "Upload"
   - Follow the prompts (sign in with Apple ID)
   - Wait for upload to complete

---

## Step 4: Create App Store Listing

### Go to App Store Connect
https://appstoreconnect.apple.com

1. **Create New App**
   - Click "My Apps" → "+" → "New App"
   - Platform: iOS
   - Name: ChromaViewer
   - Primary Language: English
   - Bundle ID: com.chromaviewer.app (should auto-populate)
   - SKU: chromaviewer-001 (your choice, internal use only)

2. **Fill Out App Information**

   **App Privacy**
   - https://appstoreconnect.apple.com → Your App → App Privacy
   - Privacy Policy URL: (use your privacy-policy.html URL)
   - Data Collection: Specify what data you collect (likely "None" for this app)

   **Category**
   - Primary: Developer Tools or Productivity
   - Secondary: Science & Technology (optional)

   **Pricing and Availability**
   - Price: Free
   - Availability: All countries (or select specific ones)

3. **Prepare for Submission**

   **App Store Description** (Example):
   ```
   ChromaViewer is a powerful, standalone chromatogram viewer for analyzing AB1 and SCF files right on your iOS device.

   FEATURES:
   • View AB1 and SCF chromatogram files
   • Sequence search and analysis
   • ORF (Open Reading Frame) finder
   • BLAST search integration
   • Reverse complement generation
   • Both horizontal and wrapped view modes
   • Smooth scrolling and navigation
   • No internet connection required for file viewing

   Perfect for researchers, students, and professionals working with DNA sequencing data on the go.
   ```

   **Keywords** (100 characters max):
   ```
   chromatogram,sequencing,DNA,AB1,SCF,genetics,BLAST,ORF,bioinformatics
   ```

   **Support URL**: Your website or GitHub repo

   **Marketing URL**: (optional)

4. **Upload Screenshots**
   - Drag and drop your prepared screenshots
   - Add captions if desired

5. **Upload App Preview Video** (Optional)
   - 15-30 second video showing app in action

6. **Build Selection**
   - After upload completes (Step 3), select your build
   - May take 10-30 minutes for build to appear

7. **Age Rating**
   - Answer the questionnaire
   - Likely result: 4+

8. **App Review Information**
   - Contact information (phone, email)
   - Demo account (if app requires login - not applicable for you)
   - Notes for reviewer: "ChromaViewer is a scientific tool for viewing DNA chromatogram files. No special setup required."

---

## Step 5: Submit for Review

1. **Click "Submit for Review"**
2. **Export Compliance**
   - Most apps answer "No" to encryption questions
   - ChromaViewer likely doesn't use encryption beyond HTTPS

3. **Advertising Identifier**
   - Select "No" if you don't use ads or analytics

4. **Submit**

---

## Review Timeline

- **Initial review**: 24-72 hours typically
- **Status updates**: Check App Store Connect
- You'll receive email notifications

### Common Rejection Reasons (and how to avoid):
1. Missing privacy policy → You have one already ✓
2. App crashes → Test thoroughly before submitting
3. Missing features from description → Only describe what works
4. Requires login but no test account → Not applicable

---

## After Approval

1. **App goes live automatically** (or on date you specified)
2. **Monitor reviews and ratings**
3. **Plan updates**:
   - Increment version for feature updates
   - Increment build number for bug fixes

---

## Quick Command Reference

```bash
# Build web app and sync to iOS
npm run build:mobile

# Open in Xcode
npm run cap:ios

# Sync changes without rebuilding
npm run cap:sync
```

---

## Differences from Google Play

**Easier aspects:**
- No app signing complexity (Xcode handles it)
- No app bundle format confusion
- Clearer review guidelines
- Better documentation
- Faster review process usually

**More restrictive:**
- Must use Mac for final build
- Stricter review process (but more transparent)
- $99/year cost
- Less flexibility with beta testing

---

## Need Help?

- **App Store Connect Help**: https://help.apple.com/app-store-connect/
- **Human Interface Guidelines**: https://developer.apple.com/design/human-interface-guidelines/
- **App Review Guidelines**: https://developer.apple.com/app-store/review/guidelines/
- **TestFlight (Beta Testing)**: Available for free before full release

---

## Troubleshooting

### "No signing identity found"
- Go to Xcode → Preferences → Accounts
- Add your Apple ID
- Download certificates

### "Failed to create provisioning profile"
- Xcode → Preferences → Accounts → Manage Certificates
- Click "+" → iOS Development

### Build errors in Xcode
- Clean build folder: Product → Clean Build Folder
- Close and reopen Xcode
- Run `npm run cap:sync` again

### Upload stuck or fails
- Check your internet connection
- Try Application Loader (alternative upload tool)
- Verify Apple ID has App Store Connect access

---

Good luck with your submission! The Apple process is typically smoother than Google Play once you have a Mac set up.
