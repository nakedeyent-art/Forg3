import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.forg3.sign',
  appName: 'Forg3',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
