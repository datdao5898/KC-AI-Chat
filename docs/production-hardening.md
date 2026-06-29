# Production Hardening Notes

Tài liệu này ghi lại các bước hardening khuyến nghị cho `KC-AI-Chat` khi chạy trên VPS hoặc máy production.

## 1. Nginx rate-limit

Nếu anh muốn đẩy thêm lớp bảo vệ ở Nginx, có thể thêm vào `http {}`:

```nginx
limit_req_zone $binary_remote_addr zone=kc_webhook:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=kc_website_chat:10m rate=20r/m;
limit_req_zone $binary_remote_addr zone=kc_auth:10m rate=5r/m;
```

Gợi ý cấu hình theo location:

```nginx
location /webhooks/ {
    limit_req zone=kc_webhook burst=20 nodelay;
    limit_req_status 429;
}

location /webhooks/website-chat {
    limit_req zone=kc_website_chat burst=10 nodelay;
    limit_req_status 429;
}

location /auth/login {
    limit_req zone=kc_auth burst=5 nodelay;
    limit_req_status 429;
}
```

Lớp rate-limit ở app đã có sẵn, Nginx chỉ là lớp chặn thêm ở cửa ngoài.

## 2. Chạy service bằng user không phải root

Khuyến nghị tạo user riêng cho app:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin kc-ai-chat
sudo chown -R kc-ai-chat:kc-ai-chat /srv/KC-AI-Chat
```

Khi dùng systemd service, đặt:

```ini
[Service]
User=kc-ai-chat
Group=kc-ai-chat
WorkingDirectory=/srv/KC-AI-Chat
EnvironmentFile=/srv/KC-AI-Chat/.env
ExecStart=/usr/bin/node /srv/KC-AI-Chat/src/server.js
Restart=always
RestartSec=5
```

Sau khi sửa file service:

```bash
sudo systemctl daemon-reload
sudo systemctl restart kc-ai-chat
sudo systemctl status kc-ai-chat
```

## 3. Script vận hành định kỳ

Các script mới có thể chạy qua cron hoặc systemd timer:

```bash
node scripts/rotate-logs.js --dry-run
```

Nếu ổn, bỏ `--dry-run` và lên lịch, ví dụ:

```cron
0 2 * * * cd /srv/KC-AI-Chat && /usr/bin/node scripts/rotate-logs.js
```

## 4. Ghi chú an toàn

- Không in secret, token, hoặc password ra log.
- `GET /health` nên giữ nhẹ để monitor ngoài.
- `GET /api/health/deep` dùng cho kiểm tra nội bộ sau khi đăng nhập.
- Khi rollback, giữ lại dữ liệu `data/*.log` và file `.env` đã mã hóa.
