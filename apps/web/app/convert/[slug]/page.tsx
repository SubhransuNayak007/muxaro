import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowRight,
  ShieldCheck,
  Zap,
  HardDrive,
  Clock,
  CheckCircle2,
  HelpCircle,
  FileCode2,
  ChevronRight,
  Sliders,
} from 'lucide-react';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildHowToJsonLd,
  buildFaqJsonLd,
  buildBreadcrumbsJsonLd,
} from '@/lib/seo';

interface ConversionDefinition {
  slug: string;
  title: string;
  heading: string;
  subheading: string;
  description: string;
  sourceFormat: string;
  targetFormat: string;
  isAudio: boolean;
  isStreamCopyEligible: boolean;
  primaryKeyword: string;
  answerBlock: string;
  steps: Array<{ name: string; text: string }>;
  faqs: Array<{ question: string; answer: string }>;
}

const CONVERSION_PAIRS: Record<string, ConversionDefinition> = {
  'youtube-to-mp3': {
    slug: 'youtube-to-mp3',
    title: 'YouTube to MP3 Converter (320kbps & Lossless) — MUXARO',
    heading: 'Fast, Ad-Free YouTube to MP3 Converter',
    subheading: 'Extract studio-grade 320 kbps MP3 or bit-perfect Opus audio directly from YouTube with zero ads and no pop-ups.',
    description: 'Convert YouTube videos to 320kbps MP3 or lossless Opus audio tracks with zero quality loss. 100% ad-free, 4 GB limit, 60-min automatic wipe.',
    sourceFormat: 'YouTube Video',
    targetFormat: 'MP3 (320 kbps)',
    isAudio: true,
    isStreamCopyEligible: true,
    primaryKeyword: 'youtube to mp3 converter',
    answerBlock: 'MUXARO is a secure, ad-free YouTube to MP3 converter that extracts native audio streams without deceptive pop-up ads or malware redirects. It provides authentic 320 kbps MP3 transcoding and lossless Opus bitstream demuxing up to 4 GB with an automated 60-minute privacy wipe.',
    steps: [
      { name: 'Paste YouTube URL', text: 'Copy the YouTube video or Shorts link and paste it into the MUXARO conversion box.' },
      { name: 'Select MP3 Quality', text: 'Choose 320 kbps MP3 for universal device compatibility, or select original bitstream copy.' },
      { name: 'Download Your Audio Track', text: 'Click Convert to initiate extraction and download your high-fidelity MP3 file immediately.' },
    ],
    faqs: [
      {
        question: 'Does MUXARO provide genuine 320 kbps MP3 audio?',
        answer: 'Yes. Unlike legacy downloaders that perform fake upsampling on low-bitrate audio, MUXARO analyzes the actual audio stream and offers authentic 320 kbps CBR/VBR encoding or lossless bitstream copy (-c:a copy).',
      },
      {
        question: 'Can I convert long YouTube videos and DJ sets to MP3?',
        answer: 'Yes. MUXARO supports files up to 4 GB with no artificial duration limits, easily processing multi-hour concerts, podcasts, and audiobooks.',
      },
      {
        question: 'Is it completely free with no advertisements?',
        answer: 'Yes. MUXARO has zero display ads, zero pop-up windows, and zero notification hijackers. All features are free with a rolling daily allowance.',
      },
    ],
  },
  'mkv-to-mp4': {
    slug: 'mkv-to-mp4',
    title: 'Free MKV to MP4 Converter Online (Up to 4GB) — MUXARO',
    heading: 'MKV to MP4 Lossless Stream-Copy Converter',
    subheading: 'Remux MKV video containers into universal MP4 in under 3 seconds using lossless bitstream copy without re-encoding.',
    description: 'Convert MKV to MP4 online without quality loss. Instant stream-copy remuxing (-c copy), handles files up to 4 GB, zero ads.',
    sourceFormat: 'MKV',
    targetFormat: 'MP4',
    isAudio: false,
    isStreamCopyEligible: true,
    primaryKeyword: 'mkv to mp4 online free',
    answerBlock: 'MUXARO converts MKV containers to MP4 in under 3 seconds using direct stream-copy remuxing (FFmpeg -c copy). Because video and audio packets are repacked without re-encoding, there is zero generational quality loss, zero CPU rendering wait, and full 4 GB file support without ads.',
    steps: [
      { name: 'Select or Paste MKV Media', text: 'Upload your MKV video file up to 4 GB or paste an online video link.' },
      { name: 'Choose Stream-Copy Mode', text: 'Enable Direct Stream Copy to repack the video without lossy re-encoding.' },
      { name: 'Download Universal MP4', text: 'Receive your playable MP4 video ready for QuickTime, iPhone, and editing suites.' },
    ],
    faqs: [
      {
        question: 'Why is MKV to MP4 conversion so fast on MUXARO?',
        answer: 'MUXARO uses container remuxing (stream copy). If the MKV already contains H.264/H.265 video and AAC audio, we repack the bitstream into an MP4 container in seconds without decoding or re-encoding frames.',
      },
      {
        question: 'Is there any loss of video quality when converting MKV to MP4?',
        answer: 'No. When stream copying is applied, the output video is bit-for-bit identical to the source MKV stream.',
      },
      {
        question: 'What is the maximum file size for MKV files?',
        answer: 'MUXARO supports up to 4,000 MB (4 GB) per file for free, whereas typical competitors cap free users at 100 MB.',
      },
    ],
  },
  'webm-to-mp4': {
    slug: 'webm-to-mp4',
    title: 'Convert WebM to MP4 60fps Online Losslessly — MUXARO',
    heading: 'WebM to MP4 60fps Converter',
    subheading: 'Convert VP9 and AV1 WebM recordings to high-compatibility H.264 MP4 with full 60fps and 4K preservation.',
    description: 'Convert WebM to MP4 60fps online losslessly. Fast transcoding, 4 GB free allowance, no watermarks, zero pop-up ads.',
    sourceFormat: 'WebM',
    targetFormat: 'MP4',
    isAudio: false,
    isStreamCopyEligible: false,
    primaryKeyword: 'webm to mp4 60fps',
    answerBlock: 'MUXARO converts VP9 and AV1 WebM files into universal H.264 MP4 containers while preserving full 60fps frame rates and original resolutions up to 4K. With a 4 GB free limit and no watermarks, it resolves browser recording incompatibility issues cleanly and privately.',
    steps: [
      { name: 'Upload WebM File', text: 'Upload your browser recording or WebM video file up to 4 GB.' },
      { name: 'Confirm MP4 Preset', text: 'Select H.264 MP4 with automatic 60fps frame rate preservation.' },
      { name: 'Download Completed MP4', text: 'Export and download your converted MP4 file ready for editing software.' },
    ],
    faqs: [
      {
        question: 'Does converting WebM to MP4 preserve 60fps?',
        answer: 'Yes. MUXARO detects the source framerate and preserves 60fps, 120fps, and variable frame rates without stutter or frame dropping.',
      },
      {
        question: 'Are there any watermarks added to the exported video?',
        answer: 'Never. MUXARO does not add watermarks, intro logos, or branding to your processed media.',
      },
    ],
  },
  'youtube-to-flac': {
    slug: 'youtube-to-flac',
    title: 'YouTube to FLAC 24-bit Audio Extractor — MUXARO',
    heading: 'YouTube to FLAC Lossless Audio Extractor',
    subheading: 'Extract pristine uncompressed audio from music streams into studio-grade 24-bit FLAC containers.',
    description: 'Extract YouTube audio to 24-bit FLAC online. Studio-grade conversion, zero dynamic range compression, 100% ad-free.',
    sourceFormat: 'YouTube Video',
    targetFormat: 'FLAC (24-bit Lossless)',
    isAudio: true,
    isStreamCopyEligible: false,
    primaryKeyword: 'youtube to flac 24bit',
    answerBlock: 'MUXARO extracts the highest available audio bitstream from YouTube and encodes it into 24-bit FLAC with psychoacoustic optimization. This ensures zero generational MP3 compression artifacts, providing audiophiles and producers with clean tracks up to 4 GB without ads.',
    steps: [
      { name: 'Paste Music Link', text: 'Provide the YouTube music video or live performance URL.' },
      { name: 'Select FLAC Container', text: 'Choose 24-bit Lossless FLAC preset for master-quality audio archiving.' },
      { name: 'Download Studio FLAC', text: 'Download your lossless FLAC track with original sample rates preserved.' },
    ],
    faqs: [
      {
        question: 'Why choose FLAC over MP3 for YouTube audio?',
        answer: 'FLAC uses lossless compression, preventing the additional lossy artifacting that occurs when re-compressing YouTube streams into MP3 format.',
      },
      {
        question: 'What sample rate is used for FLAC extraction?',
        answer: 'MUXARO extracts audio at the native 48kHz / 44.1kHz stream master rate, avoiding artificial resampling distortions.',
      },
    ],
  },
  'youtube-to-wav': {
    slug: 'youtube-to-wav',
    title: 'YouTube to WAV Converter (100% Lossless Audio) — MUXARO',
    heading: 'YouTube to WAV Lossless PCM Audio Converter',
    subheading: 'Convert YouTube audio to uncompressed 16/24-bit WAV for music production, DAWs, and editing workflows.',
    description: 'Convert YouTube to WAV lossless audio online. Broadcast-quality PCM WAV for music producers and video editors. Free, 0 ads.',
    sourceFormat: 'YouTube Video',
    targetFormat: 'WAV (Uncompressed PCM)',
    isAudio: true,
    isStreamCopyEligible: false,
    primaryKeyword: 'youtube to wav lossless',
    answerBlock: 'MUXARO converts YouTube video streams into uncompressed linear PCM WAV audio. Ideal for digital audio workstations (DAWs) like Ableton, FL Studio, and Logic Pro, it prevents lossy compression artifacts and supports multi-hour recordings with zero ads and an automatic 60-minute wipe.',
    steps: [
      { name: 'Submit Video URL', text: 'Paste the video or stream URL into the MUXARO workspace.' },
      { name: 'Choose WAV Format', text: 'Select Uncompressed WAV (PCM) for seamless DAW and editing compatibility.' },
      { name: 'Download Uncompressed WAV', text: 'Export and download your pristine WAV track ready for immediate sampling.' },
    ],
    faqs: [
      {
        question: 'Is the generated WAV compatible with all audio editors?',
        answer: 'Yes. MUXARO generates standard RIFF PCM WAV files fully compatible with Premiere, Final Cut, DaVinci Resolve, Audacity, and all DAWs.',
      },
      {
        question: 'Is there a limit on audio duration for WAV conversion?',
        answer: 'No. Files up to 4 GB can be processed freely, allowing lengthy audio recordings and podcasts to be exported without timeouts.',
      },
    ],
  },
  'mov-to-mp4': {
    slug: 'mov-to-mp4',
    title: 'MOV to MP4 Converter Fast Online (Up to 4GB) — MUXARO',
    heading: 'MOV to MP4 High-Speed Video Converter',
    subheading: 'Convert Apple QuickTime MOV footage to universal MP4 format with full ProRes to H.264 transcoding or direct remuxing.',
    description: 'Convert Apple MOV to MP4 online free. Fast conversion for iPhone and camera footage up to 4 GB with zero advertisements.',
    sourceFormat: 'Apple MOV',
    targetFormat: 'MP4',
    isAudio: false,
    isStreamCopyEligible: true,
    primaryKeyword: 'mov to mp4 converter fast',
    answerBlock: 'MUXARO converts Apple QuickTime MOV videos to universal MP4 containers with instant stream-copy remuxing for H.264/HEVC tracks or rapid transcoding for ProRes footage. Supporting 4 GB files from iPhones and professional cameras, it runs 100% ad-free with automated ephemeral deletion.',
    steps: [
      { name: 'Upload MOV File', text: 'Select your iPhone or camera MOV video file up to 4 GB.' },
      { name: 'Choose MP4 Format', text: 'Select MP4 output with automatic stream copying or H.264 encoding.' },
      { name: 'Download Universal MP4', text: 'Download your web-ready MP4 video compatible with all devices and browsers.' },
    ],
    faqs: [
      {
        question: 'Can MUXARO convert large 4K iPhone MOV videos?',
        answer: 'Yes. MUXARO handles up to 4 GB files for free, allowing multi-gigabyte 4K 60fps iPhone recordings to be converted effortlessly.',
      },
    ],
  },
  'vp9-to-h264': {
    slug: 'vp9-to-h264',
    title: 'VP9 to H.264 Video Converter Online — MUXARO',
    heading: 'VP9 to H.264 Video Codec Transcoder',
    subheading: 'Transcode modern VP9 video streams into universal H.264 (AVC) for broad device and hardware playback compatibility.',
    description: 'Convert VP9 video to H.264 online. High-speed hardware transcoding, 4 GB free allowance, 100% ad-free workspace.',
    sourceFormat: 'VP9 Codec',
    targetFormat: 'H.264 / AVC',
    isAudio: false,
    isStreamCopyEligible: false,
    primaryKeyword: 'vp9 to h264 converter',
    answerBlock: 'MUXARO transcodes Google VP9 video streams into universally compatible H.264 (AVC) video, ensuring smooth playback across legacy smart TVs, gaming consoles, and mobile hardware. Supporting up to 4 GB files, MUXARO runs completely ad-free with strict 60-minute privacy deletion.',
    steps: [
      { name: 'Upload VP9 Media', text: 'Provide your VP9 video file or stream URL.' },
      { name: 'Select H.264 Video Codec', text: 'Choose H.264 / AAC MP4 profile for universal hardware compatibility.' },
      { name: 'Download Universal Video', text: 'Export and download your converted H.264 video file.' },
    ],
    faqs: [
      {
        question: 'Why convert VP9 to H.264?',
        answer: 'While VP9 is efficient for web streaming, H.264 offers 99.9% universal hardware acceleration across all phones, tablets, smart TVs, and editing suites.',
      },
    ],
  },
  'av1-to-mp4': {
    slug: 'av1-to-mp4',
    title: 'AV1 to MP4 Video Converter Online — MUXARO',
    heading: 'AV1 to MP4 High-Compatibility Converter',
    subheading: 'Convert next-generation AV1 video files into standard H.264 or HEVC MP4 for seamless playback on any device.',
    description: 'Convert AV1 video to MP4 online. Fast GPU-accelerated transcoding for next-gen media up to 4 GB with zero ads.',
    sourceFormat: 'AV1 Codec',
    targetFormat: 'MP4 (H.264 / HEVC)',
    isAudio: false,
    isStreamCopyEligible: false,
    primaryKeyword: 'av1 to mp4 converter',
    answerBlock: 'MUXARO decodes next-generation AV1 video streams and transcodes them into standard H.264 or HEVC MP4 containers. This eliminates playback stutter on devices lacking dedicated AV1 hardware decoders, supporting up to 4 GB files with zero ads and an automatic 60-minute purge.',
    steps: [
      { name: 'Upload AV1 File', text: 'Provide your AV1 container or streaming link.' },
      { name: 'Select Target MP4 Codec', text: 'Choose standard H.264 for maximum compatibility or HEVC for high compression.' },
      { name: 'Download Universal MP4', text: 'Download your stutter-free MP4 video ready for playback anywhere.' },
    ],
    faqs: [
      {
        question: 'Why won\'t AV1 videos play smoothly on my computer?',
        answer: 'AV1 requires significant CPU power to decode without dedicated hardware acceleration. Converting to H.264 enables hardware acceleration on all GPUs.',
      },
    ],
  },
  'ts-to-mp4': {
    slug: 'ts-to-mp4',
    title: 'TS to MP4 Stream Converter Online — MUXARO',
    heading: 'MPEG-TS to MP4 Stream Converter',
    subheading: 'Convert broadcast transport stream (.ts) files into standard MP4 containers with lossless stream copy in seconds.',
    description: 'Convert TS to MP4 online. Fast MPEG-TS container remuxing without re-encoding. 4 GB limit, zero ads, private wipe.',
    sourceFormat: 'MPEG-TS (.ts)',
    targetFormat: 'MP4',
    isAudio: false,
    isStreamCopyEligible: true,
    primaryKeyword: 'ts to mp4 converter online',
    answerBlock: 'MUXARO remuxes broadcast MPEG Transport Stream (.ts) recordings into standardized MP4 containers in seconds using direct stream-copying. Since TS streams typically already use H.264 and AAC, conversion requires zero re-encoding, preserving 100% of the original broadcast quality.',
    steps: [
      { name: 'Upload TS Recording', text: 'Select your .ts broadcast recording file up to 4 GB.' },
      { name: 'Select Direct Remux', text: 'Choose MP4 output with Direct Stream Copy enabled.' },
      { name: 'Download Clean MP4', text: 'Download your finalized MP4 file playable on any media player.' },
    ],
    faqs: [
      {
        question: 'Can MUXARO fix audio sync issues common in TS streams?',
        answer: 'Yes. MUXARO synchronizes presentation timestamps (PTS) during remuxing, eliminating common audio desync issues found in IPTV and broadcast captures.',
      },
    ],
  },
  'm4a-to-mp3': {
    slug: 'm4a-to-mp3',
    title: 'M4A to MP3 Converter (320kbps High Quality) — MUXARO',
    heading: 'M4A to MP3 High-Fidelity Audio Converter',
    subheading: 'Convert Apple M4A and AAC audio files to 320 kbps MP3 with full metadata and album artwork preservation.',
    description: 'Convert M4A to MP3 online at 320kbps. High-fidelity audio transcoding, preserves ID3 tags, 4 GB limit, 0 ads.',
    sourceFormat: 'Apple M4A (AAC)',
    targetFormat: 'MP3 (320 kbps)',
    isAudio: true,
    isStreamCopyEligible: false,
    primaryKeyword: 'm4a to mp3 320kbps',
    answerBlock: 'MUXARO converts Apple M4A voice memos and AAC music tracks into 320 kbps MP3 format with high-fidelity psychoacoustic encoding. It preserves title, artist, and album metadata across files up to 4 GB with zero advertisements and an automated 60-minute storage purge.',
    steps: [
      { name: 'Upload M4A Track', text: 'Add your M4A audio recording or music file.' },
      { name: 'Select 320 kbps MP3', text: 'Choose top-tier 320 kbps bitrate for rich audio reproduction.' },
      { name: 'Download Universal MP3', text: 'Receive your standard MP3 file compatible with any car audio, phone, or DAW.' },
    ],
    faqs: [
      {
        question: 'Will ID3 tags and cover art be retained in MP3?',
        answer: 'Yes. MUXARO passes through metadata tags including title, artist, album, and track number during conversion.',
      },
    ],
  },
};

interface Props {
  params: {
    slug: string;
  };
}

export function generateStaticParams() {
  return Object.keys(CONVERSION_PAIRS).map((slug) => ({
    slug,
  }));
}

export function generateMetadata({ params }: Props): Metadata {
  const item = CONVERSION_PAIRS[params.slug];
  if (!item) {
    return constructMetadata({
      title: 'Format Converter — MUXARO',
      description: 'Universal media format converter.',
      path: `/convert/${params.slug}`,
      noIndex: true,
    });
  }

  return constructMetadata({
    title: item.title,
    description: item.description,
    path: `/convert/${item.slug}`,
    keywords: [
      item.primaryKeyword,
      `${item.sourceFormat.toLowerCase()} to ${item.targetFormat.toLowerCase()}`,
      'ad free converter',
      '4gb media converter',
      'lossless stream copy',
      'muxaro workspace',
    ],
  });
}

export default function ConversionPairPage({ params }: Props) {
  const item = CONVERSION_PAIRS[params.slug];
  if (!item) {
    notFound();
  }

  const softwareAppJsonLd = buildToolSoftwareAppJsonLd({
    name: item.heading,
    description: item.description,
    path: `/convert/${item.slug}`,
    features: [
      `Convert ${item.sourceFormat} to ${item.targetFormat}`,
      item.isStreamCopyEligible ? 'Direct bitstream copy (-c copy) in < 3 seconds' : 'High-fidelity psychoacoustic encoding',
      'Free 4 GB file size limit with zero ads',
      'Strict 60-minute ephemeral zero-retention storage purge',
    ],
  });

  const howToJsonLd = buildHowToJsonLd({
    name: `How to Convert ${item.sourceFormat} to ${item.targetFormat}`,
    description: item.description,
    path: `/convert/${item.slug}`,
    steps: item.steps,
  });

  const faqJsonLd = buildFaqJsonLd(item.faqs);

  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Convert', path: '/tools/media-converter' },
    { name: `${item.sourceFormat} to ${item.targetFormat}`, path: `/convert/${item.slug}` },
  ]);

  return (
    <div className="min-h-screen bg-base">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />

      {/* Hero Header Surface */}
      <section className="muxaro-hero-surface border-b border-line py-12 md:py-16">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-content-secondary mb-6">
            <Link href="/" className="hover:text-brand transition-colors font-medium">Home</Link>
            <ChevronRight className="w-4 h-4 text-content-muted" aria-hidden="true" />
            <Link href="/tools/media-converter" className="hover:text-brand transition-colors font-medium">Tools</Link>
            <ChevronRight className="w-4 h-4 text-content-muted" aria-hidden="true" />
            <span className="text-content font-medium">{item.sourceFormat} to {item.targetFormat}</span>
          </nav>

          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-line text-xs font-semibold text-brand mb-4">
              <Zap className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span>{item.isStreamCopyEligible ? 'Stream-Copy Remuxing Supported (< 3s)' : 'High-Speed Cloud Encoding'}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-content tracking-tight leading-tight">
              {item.heading}
            </h1>
            <p className="text-base sm:text-lg text-content-secondary mt-4 leading-relaxed">
              {item.subheading}
            </p>
          </div>

          {/* Quick Launch Card */}
          <div className="mt-8 muxaro-card p-6 sm:p-8 max-w-3xl border border-line shadow-sm">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="space-y-1 text-center sm:text-left">
                <div className="text-sm font-semibold text-content">Ready to start converting?</div>
                <div className="text-xs text-content-secondary">
                  Launch the universal converter workspace with presets configured for {item.targetFormat}.
                </div>
              </div>
              <Link
                href="/tools/media-converter"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-brand text-white font-medium hover:opacity-95 transition-opacity shadow-sm"
              >
                <span>Open {item.sourceFormat} Converter</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16 space-y-14">
        {/* LLM Authoritative Answer Block */}
        <section className="muxaro-card p-6 sm:p-8 border-l-4 border-l-brand">
          <div className="text-xs font-semibold uppercase tracking-wider text-brand mb-2">Technical Definition & Summary</div>
          <p className="text-sm sm:text-base text-content leading-relaxed font-medium">
            {item.answerBlock}
          </p>
        </section>

        {/* Value Proposition Grid */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-content tracking-tight">Why Choose MUXARO for {item.sourceFormat} to {item.targetFormat}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="muxaro-card p-5 space-y-2">
              <ShieldCheck className="w-6 h-6 text-emerald-500" aria-hidden="true" />
              <div className="text-sm font-semibold text-content">100% Ad-Free</div>
              <div className="text-xs text-content-secondary leading-relaxed">Zero pop-up windows, zero redirects, zero intrusive advertisements.</div>
            </div>
            <div className="muxaro-card p-5 space-y-2">
              <HardDrive className="w-6 h-6 text-brand" aria-hidden="true" />
              <div className="text-sm font-semibold text-content">4 GB Free File Limit</div>
              <div className="text-xs text-content-secondary leading-relaxed">40x higher than typical 100 MB limits; handles large 4K files with ease.</div>
            </div>
            <div className="muxaro-card p-5 space-y-2">
              <Zap className="w-6 h-6 text-amber-500" aria-hidden="true" />
              <div className="text-sm font-semibold text-content">Stream-Copy Speed</div>
              <div className="text-xs text-content-secondary leading-relaxed">Sub-3-second container repacking with 0% generational loss.</div>
            </div>
            <div className="muxaro-card p-5 space-y-2">
              <Clock className="w-6 h-6 text-blue-500" aria-hidden="true" />
              <div className="text-sm font-semibold text-content">60-Min Auto-Wipe</div>
              <div className="text-xs text-content-secondary leading-relaxed">Ephemeral storage architecture permanently shreds files after 60 minutes.</div>
            </div>
          </div>
        </section>

        {/* Step-by-Step How-To */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-content tracking-tight">How to Convert {item.sourceFormat} to {item.targetFormat}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {item.steps.map((s, idx) => (
              <div key={idx} className="muxaro-card p-6 space-y-3 relative">
                <div className="w-8 h-8 rounded-full bg-surface-elevated border border-line flex items-center justify-center text-sm font-bold text-brand">
                  {idx + 1}
                </div>
                <h3 className="text-base font-semibold text-content">{s.name}</h3>
                <p className="text-xs sm:text-sm text-content-secondary leading-relaxed">{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Frequently Asked Questions */}
        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-brand" aria-hidden="true" />
            <h2 className="text-2xl font-bold text-content tracking-tight">Frequently Asked Questions</h2>
          </div>
          <div className="divide-y divide-line border border-line rounded-xl bg-surface overflow-hidden">
            {item.faqs.map((f, idx) => (
              <div key={idx} className="p-6 space-y-2">
                <h3 className="text-base font-semibold text-content">{f.question}</h3>
                <p className="text-sm text-content-secondary leading-relaxed">{f.answer}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Related Format Conversions */}
        <section className="space-y-6 pt-6 border-t border-line">
          <h2 className="text-xl font-bold text-content tracking-tight">Related Conversion Tools</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Object.values(CONVERSION_PAIRS)
              .filter((p) => p.slug !== item.slug)
              .slice(0, 10)
              .map((p) => (
                <Link
                  key={p.slug}
                  href={`/convert/${p.slug}`}
                  className="muxaro-card p-3 text-xs font-medium text-content hover:text-brand hover:border-brand transition-colors block truncate"
                >
                  {p.sourceFormat} to {p.targetFormat}
                </Link>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}
