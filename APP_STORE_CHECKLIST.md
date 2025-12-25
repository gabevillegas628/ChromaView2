# Apple App Store Submission Checklist

## Before You Start
- [ ] Have access to a Mac (required)
- [ ] Install latest Xcode from Mac App Store
- [ ] Enroll in Apple Developer Program ($99/year)
- [ ] Wait for developer account approval (24-48 hours)

## Preparation
- [ ] Create app icons (1024x1024 main + various sizes)
- [ ] Take screenshots on iPhone (3-5 screenshots minimum)
  - [ ] 6.7" display (1290 x 2796) OR
  - [ ] 6.5" display (1242 x 2688) OR
  - [ ] 5.5" display (1242 x 2208)
- [ ] Take iPad screenshots if supporting iPad (2048 x 2732)
- [ ] Host privacy policy online (you already have privacy-policy.html)
- [ ] Prepare app description and keywords

## Technical Setup (DONE ✓)
- [x] Updated Info.plist with privacy descriptions
- [x] Added file type declarations (AB1, SCF)
- [x] Configured bundle identifier (com.chromaviewer.app)

## Build Process (Do on Mac)
- [ ] Run `npm install` in project directory
- [ ] Run `npm run build:mobile`
- [ ] Run `npm run cap:ios` to open Xcode
- [ ] In Xcode: Select "Any iOS Device" as target
- [ ] In Xcode: Set version number (e.g., 1.0.0)
- [ ] In Xcode: Set build number (e.g., 1)
- [ ] Product → Archive
- [ ] Wait for archive to complete
- [ ] Click "Distribute App"
- [ ] Select "App Store Connect"
- [ ] Upload and wait for processing

## App Store Connect Setup
- [ ] Go to https://appstoreconnect.apple.com
- [ ] Create new app
  - [ ] Name: ChromaViewer
  - [ ] Bundle ID: com.chromaviewer.app
  - [ ] SKU: chromaviewer-001
- [ ] Fill out app information:
  - [ ] App description
  - [ ] Keywords
  - [ ] Support URL
  - [ ] Privacy Policy URL
  - [ ] Category (Developer Tools or Productivity)
- [ ] Upload screenshots
- [ ] Set pricing (Free)
- [ ] Select availability (countries)
- [ ] Configure App Privacy (likely "No data collected")
- [ ] Answer age rating questions
- [ ] Add app review information and notes

## Final Submission
- [ ] Select uploaded build (wait for it to appear)
- [ ] Answer export compliance questions
- [ ] Answer advertising identifier questions
- [ ] Review everything one final time
- [ ] Click "Submit for Review"
- [ ] Wait for review (usually 24-72 hours)

## Post-Submission
- [ ] Monitor email for review updates
- [ ] Check App Store Connect for status
- [ ] Respond to any review questions quickly
- [ ] Celebrate when approved!

---

## Quick Reference

**Build commands:**
```bash
npm run build:mobile    # Build and sync
npm run cap:ios         # Open in Xcode
```

**Important links:**
- App Store Connect: https://appstoreconnect.apple.com
- Developer Portal: https://developer.apple.com
- Review Guidelines: https://developer.apple.com/app-store/review/guidelines/

**Timeline:**
- Developer account approval: 24-48 hours
- Build processing: 10-30 minutes
- App review: 24-72 hours typically

**Cost:**
- Apple Developer Program: $99/year
- Everything else: Free!
