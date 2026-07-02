import { Jimp } from 'jimp';
import path from 'path';
import fs from 'fs';

async function main() {
  try {
    const inputPath = path.resolve('public/logo.png');
    const outputPath = path.resolve('android/app/src/main/res/drawable/ic_stat_notification.png');

    console.log(`Loading image from: ${inputPath}`);
    const image = await Jimp.read(inputPath);

    // Resize to a standard notification icon size (96x96 is standard for xxhdpi)
    image.resize({ w: 96, h: 96 });

    // Iterate through all pixels and make them monochrome white based on transparency
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
      const red = this.bitmap.data[idx + 0];
      const green = this.bitmap.data[idx + 1];
      const blue = this.bitmap.data[idx + 2];
      const alpha = this.bitmap.data[idx + 3];

      // If it has visible alpha (non-transparent)
      if (alpha > 30) {
        // Check if the pixel is part of the background circle or the foreground logo.
        // Usually, in colored icons, the background is red/colored and foreground is white/light.
        // Let's check if the pixel is dark/reddish or light.
        // To be extremely clean, we can convert any colored pixel to white, 
        // but if the logo has a background circle, we might want to keep only the inner white shape.
        // Let's check: if the pixel is white/light, we keep it white. If it is colored (like red),
        // we make it transparent so only the inner logo shape remains!
        // Red color in GoDelivery logo is typically around R=225, G=29, B=72.
        // Let's check if the pixel is close to red, or if its green/blue components are low.
        const isReddish = (red > 150 && green < 100 && blue < 100);
        
        if (isReddish) {
          // Make it transparent so we only get the inner logo shape (like the delivery scooter or bag)
          this.bitmap.data[idx + 3] = 0;
        } else {
          // Make it solid white
          this.bitmap.data[idx + 0] = 255;
          this.bitmap.data[idx + 1] = 255;
          this.bitmap.data[idx + 2] = 255;
          this.bitmap.data[idx + 3] = 255; // Keep it fully visible
        }
      }
    });

    // Write to output path
    await image.write(outputPath);
    console.log(`Monochrome notification icon successfully saved to: ${outputPath}`);

  } catch (err) {
    console.error('Error generating monochrome icon:', err);
  }
}

main();
