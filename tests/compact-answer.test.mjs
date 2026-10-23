import test from 'node:test';import assert from 'node:assert/strict';
import {compactAnswer} from '../frontend/guide-tools.js';
test('long Vietnamese answers show a short preview without losing full content',()=>{
  const text='Ưu tiên tham quan buổi sáng. '+ 'Kiểm tra giờ mở cửa và dự toán trước khi đi. '.repeat(20);
  const result=compactAnswer(text);assert(result.collapsed);assert(result.preview.length<=361);assert.equal(result.full,text.trim());assert(result.preview.endsWith('…'));assert(!compactAnswer('Mang áo mưa và giày đi bộ.').collapsed);
});
test('plain text preview removes heading/bold markers and keeps literal unsafe text',()=>{
  const result=compactAnswer('## Ăn uống\n**Mì Quảng**\n<script>alert(1)</script>');
  assert.equal(result.preview,'Ăn uống\nMì Quảng\n<script>alert(1)</script>');
});
