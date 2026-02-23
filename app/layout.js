import './globals.css';
import Providers from './providers';

export const metadata = {
  title: 'LinkedIn Budget Pacing Tracker',
  description: 'Track your LinkedIn ad spend pacing daily',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
