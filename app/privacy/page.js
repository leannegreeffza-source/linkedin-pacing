export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 20px', fontFamily: 'sans-serif', lineHeight: 1.6 }}>
      <h1>Privacy Policy</h1>
      <p><strong>Last updated: 2026</strong></p>

      <h2>1. Introduction</h2>
      <p>This Privacy Policy describes how the LinkedIn &amp; Meta Pacing Tracker ("the App") collects, uses, and handles your information. This is an internal business tool used by Turn Left Media and its affiliates.</p>

      <h2>2. Information We Collect</h2>
      <p>The App accesses the following data through the Meta Marketing API and LinkedIn API:</p>
      <ul>
        <li>Ad account names and IDs</li>
        <li>Campaign and ad set performance data (spend, impressions, clicks)</li>
        <li>Business Manager information</li>
      </ul>

      <h2>3. How We Use Your Information</h2>
      <p>Data accessed through the APIs is used solely for internal reporting and budget pacing purposes. We do not sell, share, or distribute this data to any third parties.</p>

      <h2>4. Data Storage</h2>
      <p>No personal data is stored permanently. API data is fetched on demand and displayed in the application. Authentication tokens are stored securely in environment variables.</p>

      <h2>5. Third-Party Services</h2>
      <p>This App uses the following third-party APIs:</p>
      <ul>
        <li>Meta Marketing API (Facebook/Instagram)</li>
        <li>LinkedIn Marketing API</li>
      </ul>

      <h2>6. Contact</h2>
      <p>For questions about this privacy policy, contact: <a href="mailto:leannegreeff@turnleft.co.za">leannegreeff@turnleft.co.za</a></p>
    </div>
  );
}