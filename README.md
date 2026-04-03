## 모션 과일 슈터

웹캠으로 손을 인식해서 **핀치(엄지+검지)** 동작으로 과일 아이템을 쏘고 점수를 얻는 미니 게임입니다.

### 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 접속 후 **시작하기**를 눌러 카메라 권한을 허용하세요.

### 조작 방법

- **조준**: 검지 끝 위치가 조준점입니다.
- **발사**: 엄지와 검지를 붙이는 핀치 동작을 하면 발사됩니다.
- **목표**: 제한 시간(30초) 안에 최대 점수를 얻으세요.

### 배포 (Vercel)

- 이 프로젝트는 브라우저에서만 웹캠을 사용합니다. Vercel에 그대로 배포 가능합니다.
- Vercel에서 Import 후 기본 설정(Framework: Next.js)으로 배포하면 됩니다.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
