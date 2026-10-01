# Linux systemd 운영

웹과 검사 워커를 systemd가 관리합니다. SSH 터미널을 유지할 필요가 없고 부팅 시 시작, 오류 종료 후 재시작, journal 로그 수집이 가능합니다. `xe-status.target`으로 두 프로세스를 함께 제어합니다. 개별 프로세스 오류는 다른 프로세스를 중지시키지 않습니다.

## 1. 현재 서버에 맞게 준비

필요 조건: systemd, Node.js 22.12 이상, npm, Linux `ping` 실행 파일.

저장소의 `deploy/systemd/`에 있는 두 `.service` 파일의 기본값은 아래와 같습니다. **이미 다른 디렉터리·계정으로 설치했다면 파일의 값을 실제 환경에 맞게 수정하세요.**

| 설정 | 기본값 | 확인 |
|---|---|---|
| WorkingDirectory | /opt/xe-status | 프로젝트에서 `pwd` |
| User / Group | xe-status / xe-status | 서비스 실행 계정의 `id` |
| ExecStart의 Node 경로 | /usr/bin/node | `command -v node` |

Node는 systemd가 로그인 셸이나 nvm을 자동 로드하지 않으므로 절대 경로를 사용합니다. nvm으로 설치했다면 `command -v node` 결과를 두 서비스 파일의 `/usr/bin/node` 대신 사용하세요. 해당 계정이 그 Node 실행 파일, 프로젝트, `.env`를 읽을 수 있어야 합니다. nvm 버전 경로를 변경하면 서비스의 경로도 갱신해야 합니다.

새 전용 계정이 필요한 경우:

```bash
sudo useradd --system --user-group --home-dir /opt/xe-status --shell /usr/sbin/nologin xe-status
```

`.env`와 기존 데이터는 그대로 유지하고, 실제 서비스 계정이 DB 파일과 그 디렉터리에 쓰기 권한을 갖도록 설정하세요. 권한 변경은 프로젝트 데이터에 한정합니다. 신규 설치에는 `data` 디렉터리를 준비합니다. 기본 디렉터리 기준:

```bash
sudo install -d -o xe-status -g xe-status -m 700 /opt/xe-status/data
sudo chown xe-status:xe-status /opt/xe-status/.env
sudo chmod 600 /opt/xe-status/.env
```

이미 존재하는 DB가 다른 계정 소유라면 웹·워커를 중지한 후 해당 데이터 파일들의 소유권도 서비스 계정에 맞춰야 합니다. 기존 `.env` 또는 데이터 볼륨을 새로 생성하거나 덮어쓰지 마세요. Docker에서 네이티브 실행으로 옮길 경우 named volume의 DB와 기존 암호화 키를 함께 이전해야 합니다.

## 2. 환경 설정 및 빌드

기존 `.env`에서 아래 항목만 서버에 맞게 수정합니다. 비밀번호·암호화 키는 유지합니다.

```dotenv
NODE_ENV=production
APP_ORIGIN=https://status.example.com
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=./data/status.db
```

프로젝트 디렉터리에서 실행합니다.

```bash
npm ci
npm run build
```

서비스는 `dist`의 운영 빌드를 제공합니다. Vite 개발 서버는 실행하지 않습니다. 3000번 포트가 사용 중이면 PORT를 변경하고 Cloudflare Tunnel의 서비스 주소도 같은 포트로 맞추세요.

## 3. 서비스 등록

서비스 파일의 경로·계정을 위에서 수정한 후 프로젝트 디렉터리에서 실행합니다.

```bash
sudo install -m 644 deploy/systemd/xe-status-web.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/xe-status-worker.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/xe-status.target /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/xe-status-web.service /etc/systemd/system/xe-status-worker.service /etc/systemd/system/xe-status.target
sudo systemctl daemon-reload
sudo systemctl enable --now xe-status.target
```

기존에 직접 실행하던 이 프로젝트의 `npm start`, `npm run worker` 또는 Docker 컨테이너는 서비스 시작 전에 종료합니다. 같은 DB에 여러 워커를 중복 실행하지 않도록 합니다.

## 4. 관리 명령

```bash
# 두 서비스 상태
systemctl status xe-status-web xe-status-worker

# 함께 재시작 / 중지 / 시작
sudo systemctl restart xe-status.target
sudo systemctl stop xe-status.target
sudo systemctl start xe-status.target

# 실시간 통합 로그
sudo journalctl -u xe-status-web -u xe-status-worker -f

# 자동 시작 해제 및 중지
sudo systemctl disable --now xe-status.target
```

`xe-status.target` 자체가 active인 것만으로 웹·워커 정상 실행을 보장하지 않습니다. 두 서비스 상태를 확인하세요. 잘못된 환경 변수·권한·포트로 연속 실패했다면 원인을 수정한 뒤 `sudo systemctl reset-failed xe-status-web xe-status-worker`와 `sudo systemctl restart xe-status.target`을 실행합니다.

코드 업데이트는 프로젝트 디렉터리에서 `git pull --ff-only`, `npm ci`, `npm run build`를 실행한 다음 target을 재시작합니다. 실행 중인 파일을 교체하는 짧은 불일치를 피하려면 업데이트 전에 target을 중지하고 빌드 후 시작하세요. 서비스 파일 자체를 변경했다면 다시 설치하고 `daemon-reload`도 실행합니다.

## Cloudflare Tunnel

서버 OS에 설치한 `cloudflared`도 시스템 서비스로 실행합니다. Cloudflare 대시보드에서 서버 OS를 선택하면 서비스 설치 명령을 제공합니다. 터널의 Published application 설정은 `status.example.com` → `http://127.0.0.1:3000`으로 연결합니다. 프로젝트의 APP_ORIGIN은 `https://status.example.com`으로 유지합니다. Nginx 설치는 필요 없습니다.

cloudflared가 별도 컨테이너라면 해당 컨테이너의 localhost는 호스트가 아닙니다. 이 문서의 루프백 주소는 cloudflared를 호스트 OS에서 실행하는 구성을 기준으로 합니다.

공식 참고: [systemd 서비스 설정](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html), [systemd 의존 관계](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html), [Cloudflare Tunnel 설정](https://developers.cloudflare.com/tunnel/get-started/).
