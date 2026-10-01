import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const password = randomBytes(24).toString('base64url');
const content = [
  `ADMIN_PASSWORD=${password}`,
  `ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`,
  'APP_ORIGIN=http://localhost:5173',
  'HOST=127.0.0.1',
  'PORT=3000',
  'DATABASE_PATH=./data/status.db',
  'NODE_ENV=development',
  ''
].join('\n');

try {
  writeFileSync(new URL('../.env', import.meta.url), content, { flag: 'wx', mode: 0o600 });
  console.log('.env 파일을 생성했습니다. 관리자 비밀번호:', password);
  console.log('npm run dev 실행 후 http://localhost:5173/admin 에서 로그인하세요.');
  console.log('ENCRYPTION_KEY는 저장된 설정 복호화에 필요하므로 DB와 함께 안전하게 보관하세요.');
} catch (error) {
  if (error.code === 'EEXIST') {
    console.log('.env 파일이 이미 있습니다. 기존 설정을 유지합니다.');
  } else throw error;
}
