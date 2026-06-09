(function () {
  const guides = {
    vi: {
      toc: 'Nội dung',
      openPage: 'Mở chức năng',
      sections: [
        {
          id: 'start',
          title: 'Bắt đầu sử dụng',
          summary: 'Quy trình ngắn để kiểm tra hệ thống mỗi ngày.',
          steps: [
            'Đăng nhập và mở Tổng quan để kiểm tra số hội thoại, cảnh báo và tin cần nhân viên.',
            'Mở Cảnh báo để xử lý các trường hợp AI chưa trả lời chắc chắn.',
            'Mở Hội thoại để xem khách mới và các cuộc chat đang cần hỗ trợ.',
            'Kiểm tra Nhật ký khi thấy tin nhắn không được gửi hoặc AI không phản hồi.'
          ],
          link: '/admin/',
          linkLabel: 'Mở Tổng quan'
        },
        {
          id: 'conversations',
          title: 'Quản lý hội thoại',
          summary: 'Theo dõi khách từ Facebook, Zalo và website trong cùng một màn hình.',
          steps: [
            'Chọn kênh, sau đó chọn fanpage hoặc website cần xem.',
            'Auto ON nghĩa là AI vẫn đang tự trả lời. Auto OFF nghĩa là chỉ nhân viên xử lý.',
            'Cần nhân viên nghĩa là hệ thống đã tạo cảnh báo để người phụ trách kiểm tra.',
            'Với website chat, nhân viên có thể trả lời văn bản hoặc gửi ảnh ngay trong hội thoại.',
            'Nút Đánh dấu sai dùng khi câu trả lời AI chưa đúng để lưu vào mục Cần cải thiện.',
            'Xóa hội thoại sẽ xóa vĩnh viễn dữ liệu hội thoại đó, nên cần kiểm tra kỹ trước khi xác nhận.'
          ],
          link: '/admin/conversations.html',
          linkLabel: 'Mở Hội thoại'
        },
        {
          id: 'alerts',
          title: 'Xử lý cảnh báo',
          summary: 'Cảnh báo xuất hiện khi AI thiếu dữ liệu, không chắc câu trả lời hoặc khách yêu cầu nhân viên.',
          steps: [
            'Mở cảnh báo để xem lý do, nội dung khách hỏi và nguồn gửi tin.',
            'Mở hội thoại liên quan để đọc đủ ngữ cảnh trước khi liên hệ khách.',
            'Sau khi xử lý, đánh dấu Đã xử lý để danh sách chỉ còn các việc đang chờ.',
            'Cảnh báo gửi qua Lark chỉ là thông báo; dữ liệu đầy đủ vẫn nằm trong trang admin.'
          ],
          link: '/admin/alerts.html',
          linkLabel: 'Mở Cảnh báo'
        },
        {
          id: 'training',
          title: 'Cập nhật kiến thức',
          summary: 'Dữ liệu riêng của từng fanpage hoặc website được ưu tiên hơn dữ liệu dùng chung.',
          steps: [
            'Chọn đúng nguồn trước khi sửa: Common, fanpage hoặc website.',
            'Catalog sản phẩm CSV dùng cho tên sản phẩm, giá, mô tả, thương hiệu và đường dẫn.',
            'FAQ dùng cho các câu hỏi thường gặp và cách trả lời ngắn gọn.',
            'Chính sách dùng cho VAT, bảo hành, đổi trả, giao hàng và hóa đơn.',
            'Sau khi bấm Lưu hoặc Upload, dữ liệu mới được dùng cho tin nhắn tiếp theo; không cần restart app.',
            'Không đưa token, mật khẩu hoặc API key vào bất kỳ file training nào.'
          ],
          note: 'Khi hai nguồn có nội dung khác nhau, dữ liệu riêng của fanpage hoặc website đang nhận tin sẽ được ưu tiên.',
          link: '/admin/knowledge.html',
          linkLabel: 'Mở Training'
        },
        {
          id: 'improvements',
          title: 'Cải thiện câu trả lời AI',
          summary: 'Lưu lại các câu trả lời chưa đúng để đội vận hành biết phần kiến thức nào cần bổ sung.',
          steps: [
            'Trong Hội thoại, bấm Đánh dấu sai tại câu trả lời cần xem lại.',
            'Ghi chú ngắn lỗi nằm ở đâu: sai sản phẩm, sai chính sách, lạc đề hoặc thiếu dữ liệu.',
            'Mở Cần cải thiện để rà soát theo nguồn và cập nhật đúng file training.',
            'Sau khi sửa training, thử lại bằng một câu hỏi tương tự trước khi kết thúc kiểm tra.'
          ],
          link: '/admin/improvements.html',
          linkLabel: 'Mở Cần cải thiện'
        },
        {
          id: 'widget',
          title: 'Widget website',
          summary: 'KingCom và NewLite dùng chung hệ thống nhưng có tên, màu và nguồn kiến thức riêng.',
          steps: [
            'KingCom dùng data-site-name="kingcom" và màu xanh #007f7b.',
            'NewLite dùng data-site-name="newlite" và màu hồng #ff2d94.',
            'Khách có thể nhập tên, số điện thoại, gửi văn bản, chọn ảnh hoặc dán ảnh bằng Ctrl+V.',
            'Tin nhắn website xuất hiện trong Hội thoại, nhóm Website, đúng theo tên nguồn.',
            'Khi nhân viên trả lời trong admin, tin nhắn sẽ trở lại đúng widget của khách.'
          ],
          code: '<script src="https://ai.kingcom.com.vn/widget.js" data-site-name="newlite"></script>'
        },
        {
          id: 'troubleshooting',
          title: 'Khi app có vấn đề',
          summary: 'Các bước kiểm tra đơn giản trước khi chỉnh code hoặc training.',
          steps: [
            'Không nhận tin: kiểm tra app đang chạy, domain public còn hoạt động và webhook đúng URL.',
            'Có nhận tin nhưng không trả lời: mở Nhật ký để xem lỗi provider, database hoặc AI Judge.',
            'Trả lời sai sản phẩm: kiểm tra đúng nguồn, catalog và thương hiệu của fanpage hoặc website.',
            'Không biết chính sách: bổ sung câu trả lời rõ ràng vào FAQ hoặc Chính sách của đúng nguồn.',
            'Ảnh không hiển thị: kiểm tra thư mục data/website-media còn tồn tại và app có quyền ghi.',
            'Lỗi quá nhiều yêu cầu: chờ một phút rồi thử lại; hệ thống có rate limit để chống spam.'
          ],
          link: '/admin/logs.html',
          linkLabel: 'Mở Nhật ký'
        },
        {
          id: 'daily',
          title: 'Checklist vận hành',
          summary: 'Danh sách ngắn dành cho người trực hệ thống.',
          checks: [
            'Xem cảnh báo mới và các hội thoại cần nhân viên.',
            'Kiểm tra vài câu trả lời gần nhất của từng kênh.',
            'Xử lý các câu đã đánh dấu Cần cải thiện.',
            'Cập nhật catalog, FAQ hoặc chính sách khi có thông tin mới.',
            'Không chia sẻ tài khoản admin, API key hoặc file .env.',
            'Backup dữ liệu trước khi cập nhật lớn hoặc thay đổi cấu hình VPS.'
          ]
        }
      ]
    },
    en: {
      toc: 'Contents',
      openPage: 'Open page',
      sections: [
        { id: 'start', title: 'Getting started', summary: 'A short daily system check.', steps: ['Open Overview and check conversations, alerts and staff requests.', 'Review Alerts for questions the AI could not answer safely.', 'Open Conversations to handle new customers.', 'Use Logs when messages or AI replies fail.'], link: '/admin/', linkLabel: 'Open Overview' },
        { id: 'conversations', title: 'Manage conversations', summary: 'Handle Facebook, Zalo and website customers in one place.', steps: ['Choose a channel, then select the page or website.', 'Auto ON means AI can reply; Auto OFF means staff handles the chat.', 'Needs staff means the system has raised an alert.', 'Website staff can send text and images from the conversation.', 'Mark wrong stores an AI reply for review.', 'Deleting a conversation permanently removes its data.'], link: '/admin/conversations.html', linkLabel: 'Open Conversations' },
        { id: 'alerts', title: 'Handle alerts', summary: 'Alerts are created for missing data, uncertain replies or staff requests.', steps: ['Read the reason, customer message and source.', 'Open the related conversation for full context.', 'Mark it resolved after staff completes the work.', 'Lark is a notification channel; the complete data stays in Admin.'], link: '/admin/alerts.html', linkLabel: 'Open Alerts' },
        { id: 'training', title: 'Update knowledge', summary: 'Source-specific data takes priority over common data.', steps: ['Select the correct Common, page or website source.', 'Products CSV contains product facts.', 'FAQ contains common questions and short answers.', 'Policies contains VAT, warranty, returns, shipping and invoices.', 'Saved data applies to the next message without restarting the app.', 'Never store tokens, passwords or API keys in training files.'], note: 'When sources conflict, the active page or website source takes priority.', link: '/admin/knowledge.html', linkLabel: 'Open Training' },
        { id: 'improvements', title: 'Improve AI replies', summary: 'Track incorrect replies and update the missing knowledge.', steps: ['Mark the incorrect reply in Conversations.', 'Note whether it is a wrong product, policy, context or missing-data issue.', 'Review the item in Improvements and update the correct training source.', 'Retest with a similar customer question.'], link: '/admin/improvements.html', linkLabel: 'Open Improvements' },
        { id: 'widget', title: 'Website widget', summary: 'KingCom and NewLite share the app but keep separate branding and knowledge.', steps: ['KingCom uses data-site-name="kingcom" and #007f7b.', 'NewLite uses data-site-name="newlite" and #ff2d94.', 'Customers can send text, contact details and images.', 'Website messages appear under the matching Website source.', 'Staff replies return to the customer widget.'], code: '<script src="https://ai.kingcom.com.vn/widget.js" data-site-name="newlite"></script>' },
        { id: 'troubleshooting', title: 'Troubleshooting', summary: 'Basic checks before changing code or training.', steps: ['No incoming messages: check the app, public domain and webhook URL.', 'No reply: inspect Logs for provider, database or AI Judge errors.', 'Wrong product: verify the source, catalog and page brand.', 'Unknown policy: add a clear answer to the correct FAQ or Policies file.', 'Missing images: check data/website-media and write permissions.', 'Too many requests: wait one minute; rate limiting protects against spam.'], link: '/admin/logs.html', linkLabel: 'Open Logs' },
        { id: 'daily', title: 'Daily checklist', summary: 'A short list for system operators.', checks: ['Review new alerts and staff requests.', 'Sample recent replies from each channel.', 'Handle items marked for improvement.', 'Update product and policy knowledge when needed.', 'Do not share admin credentials, API keys or .env files.', 'Back up data before major updates.'] }
      ]
    },
    zh: {
      toc: '目录',
      openPage: '打开功能',
      sections: [
        { id: 'start', title: '开始使用', summary: '每日快速检查系统。', steps: ['打开总览，检查会话、提醒和人工请求。', '查看提醒，处理 AI 无法确认的问题。', '打开会话，处理新客户消息。', '消息或 AI 回复失败时查看日志。'], link: '/admin/', linkLabel: '打开总览' },
        { id: 'conversations', title: '管理会话', summary: '在同一页面处理 Facebook、Zalo 和网站客户。', steps: ['先选择渠道，再选择主页或网站。', 'Auto ON 表示 AI 自动回复；Auto OFF 表示由人工处理。', '需要人工表示系统已创建提醒。', '网站客服可在会话内发送文字和图片。', '标记错误会把 AI 回复保存到待改进列表。', '删除会话会永久删除相关数据。'], link: '/admin/conversations.html', linkLabel: '打开会话' },
        { id: 'alerts', title: '处理提醒', summary: '缺少资料、回复不确定或客户要求人工时会产生提醒。', steps: ['查看原因、客户消息和来源。', '打开相关会话读取完整上下文。', '处理完成后标记为已处理。', 'Lark 只负责通知，完整数据保留在管理后台。'], link: '/admin/alerts.html', linkLabel: '打开提醒' },
        { id: 'training', title: '更新知识', summary: '主页或网站专属资料优先于通用资料。', steps: ['先选择正确的通用、主页或网站来源。', '产品 CSV 保存产品信息。', 'FAQ 保存常见问题和简短回答。', '政策保存 VAT、保修、退换货、配送和发票信息。', '保存后下一条消息即可使用，无需重启应用。', '不要在训练文件中保存令牌、密码或 API Key。'], note: '资料冲突时，当前接收消息的主页或网站资料优先。', link: '/admin/knowledge.html', linkLabel: '打开训练' },
        { id: 'improvements', title: '改进 AI 回复', summary: '记录错误回复并补充缺少的知识。', steps: ['在会话中标记错误回复。', '注明产品、政策、上下文或资料缺失问题。', '在待改进页面检查并更新正确的训练来源。', '使用相似问题重新测试。'], link: '/admin/improvements.html', linkLabel: '打开待改进' },
        { id: 'widget', title: '网站聊天组件', summary: 'KingCom 与 NewLite 共用系统，但品牌和知识来源分开。', steps: ['KingCom 使用 data-site-name="kingcom" 和 #007f7b。', 'NewLite 使用 data-site-name="newlite" 和 #ff2d94。', '客户可以发送文字、联系信息和图片。', '网站消息会进入对应的网站来源。', '客服回复会返回客户的聊天组件。'], code: '<script src="https://ai.kingcom.com.vn/widget.js" data-site-name="newlite"></script>' },
        { id: 'troubleshooting', title: '问题排查', summary: '修改代码或训练前的基础检查。', steps: ['没有收到消息：检查应用、公开域名和 webhook 地址。', '没有回复：在日志中检查模型、数据库或 AI Judge 错误。', '产品错误：检查来源、产品目录和主页品牌。', '政策不清楚：在正确来源的 FAQ 或政策中补充明确答案。', '图片不显示：检查 data/website-media 和写入权限。', '请求过多：等待一分钟，限流功能用于防止垃圾请求。'], link: '/admin/logs.html', linkLabel: '打开日志' },
        { id: 'daily', title: '每日检查清单', summary: '系统运营人员的简短清单。', checks: ['查看新提醒和人工请求。', '抽查每个渠道的最近回复。', '处理待改进项目。', '有新信息时更新产品与政策知识。', '不要分享管理账号、API Key 或 .env 文件。', '重大更新前备份数据。'] }
      ]
    }
  };

  function currentGuide() {
    return guides[KC.state.lang] || guides.vi;
  }

  function sectionMarkup(section) {
    const list = section.steps
      ? `<ol class="guide-steps">${section.steps.map(item => `<li>${KC.esc(item)}</li>`).join('')}</ol>`
      : `<ul class="guide-checks">${section.checks.map(item => `<li>${KC.esc(item)}</li>`).join('')}</ul>`;
    return `
      <section class="card guide-section" id="guide-${KC.esc(section.id)}">
        <div class="guide-section-number">${String(currentGuide().sections.indexOf(section) + 1).padStart(2, '0')}</div>
        <div class="guide-section-content">
          <h3>${KC.esc(section.title)}</h3>
          <p class="guide-summary">${KC.esc(section.summary)}</p>
          ${list}
          ${section.note ? `<div class="guide-note">${KC.esc(section.note)}</div>` : ''}
          ${section.code ? `<pre class="guide-code"><code>${KC.esc(section.code)}</code></pre>` : ''}
          ${section.link ? `<a class="btn ghost guide-link" href="${KC.esc(section.link)}">${KC.esc(section.linkLabel || currentGuide().openPage)}</a>` : ''}
        </div>
      </section>
    `;
  }

  function render() {
    const guide = currentGuide();
    return `
      <div class="guide-layout">
        <aside class="card guide-toc">
          <div class="card-head"><h3>${KC.esc(guide.toc)}</h3></div>
          <nav>
            ${guide.sections.map((section, index) => `
              <a href="#guide-${KC.esc(section.id)}">
                <span>${String(index + 1).padStart(2, '0')}</span>
                ${KC.esc(section.title)}
              </a>
            `).join('')}
          </nav>
        </aside>
        <div class="guide-content">
          ${guide.sections.map(sectionMarkup).join('')}
        </div>
      </div>
    `;
  }

  KC.bootPage({
    page: 'guide',
    titleKey: 'titleGuide',
    subtitleKey: 'subtitleGuide',
    render,
    refreshButton: false
  });
})();
