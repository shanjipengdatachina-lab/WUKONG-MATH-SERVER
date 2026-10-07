<template>
  <div class="ud">
    <el-card>
      <template #header>
        <div class="head">
          <span>
            <el-button link type="primary" data-qa="back" @click="back">← 用户列表</el-button>
          </span>
          <span class="head__note">
            这一页的改动<strong>学生端立刻可见</strong>（掌握度会动成长曲线、分数会动报告）。
            每次改动都记在「变更记录」里 —— 谁、什么时候、从多少改到多少、为什么。
          </span>
        </div>
      </template>

      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />
      <el-skeleton v-if="loading" :rows="6" animated />

      <template v-else-if="ov">
        <el-tabs v-model="tab" class="udtabs">
        <el-tab-pane name="overview" label="概览">
        <!-- 头顶一行：他是谁、还能不能进 -->
        <div class="who">
          <span class="who__name">{{ ov.user.nickname || ov.user.username }}</span>
          <span class="mono dim">@{{ ov.user.username }}</span>
          <el-tag size="small" effect="plain">{{ ov.user.role === 'admin' ? '管理员' : '学生' }}</el-tag>
          <el-tag v-if="ov.user.grade" size="small" effect="plain" type="info">{{ ov.user.grade }}</el-tag>
          <el-tag v-if="ov.user.disabledAt" size="small" type="info">已停用</el-tag>
          <el-tag v-else size="small" type="success" effect="light">正常</el-tag>
          <el-tag :type="ov.membership.isMember ? 'warning' : 'info'" size="small" effect="light">
            {{ ov.membership.planName || '—' }}
          </el-tag>
          <span v-if="ov.user.disabledAt" class="dim small">停用于 {{ when(ov.user.disabledAt) }}</span>
        </div>

        <!-- ① 基本资料 -->
        <el-descriptions title="基本资料" :column="3" border class="sec">
          <el-descriptions-item label="账号"><span class="mono">{{ ov.user.username }}</span></el-descriptions-item>
          <el-descriptions-item label="昵称">{{ ov.user.nickname || '—' }}</el-descriptions-item>
          <el-descriptions-item label="年级">{{ ov.user.grade || '—' }}</el-descriptions-item>
          <el-descriptions-item label="注册时间">{{ when(ov.user.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="角色">{{ ov.user.role === 'admin' ? '管理员' : '学生' }}</el-descriptions-item>
          <el-descriptions-item label="用户 id"><span class="mono">{{ ov.user.id }}</span></el-descriptions-item>
        </el-descriptions>

        <!-- ② 会员与订单 -->
        <div class="sec">
          <h3 class="h3">会员与订单</h3>
          <div class="kpis">
            <div class="kpi">
              <b>{{ ov.membership.planName || '—' }}</b>
              <span>当前套餐</span>
            </div>
            <div class="kpi">
              <b>{{ ov.membership.daysLeft === null ? (ov.membership.isMember ? '不限' : '—') : ov.membership.daysLeft }}</b>
              <span>天后到期</span>
            </div>
            <div class="kpi">
              <b>{{ ov.orders.length }}</b>
              <span>订单数</span>
            </div>
            <div class="kpi">
              <b>{{ money(paidCents) }}</b>
              <span>已付款（不含测试通道）</span>
            </div>
          </div>
          <p v-if="ov.membership.endAt" class="dim small">到期于 {{ when(ov.membership.endAt) }}</p>

          <el-table v-if="ov.orders.length" :data="ov.orders" stripe size="small" class="mt">
            <el-table-column prop="orderNo" label="订单号" min-width="180">
              <template #default="{ row }"><span class="mono">{{ row.orderNo }}</span></template>
            </el-table-column>
            <el-table-column prop="planName" label="套餐" min-width="110" />
            <el-table-column label="金额" width="110">
              <template #default="{ row }"><span class="mono">{{ money(row.amountCents) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="130">
              <template #default="{ row }">
                <el-tag size="small" :type="statusType(row.status)" effect="light">{{ statusName(row.status) }}</el-tag>
                <el-tag v-if="row.isTest" size="small" type="info" effect="plain" class="ml">测试</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="channelName" label="通道" width="110" />
            <el-table-column label="创建" min-width="150">
              <template #default="{ row }"><span class="mono dim">{{ when(row.createdAt) }}</span></template>
            </el-table-column>
          </el-table>
          <p v-else class="dim small mt">还没有订单。</p>
        </div>

        <!-- ③ 考试成绩 -->
        <div class="sec">
          <h3 class="h3">考试成绩 <span class="h3__sub">演示数据里导入的那 {{ ov.exams.length }} 场</span></h3>
          <el-table v-if="ov.exams.length" :data="ov.exams" stripe size="small">
            <el-table-column prop="code" label="编号" width="80">
              <template #default="{ row }"><span class="mono">{{ row.code }}</span></template>
            </el-table-column>
            <el-table-column prop="name" label="考试" min-width="180" />
            <el-table-column prop="date" label="日期" width="120">
              <template #default="{ row }"><span class="mono">{{ row.date }}</span></template>
            </el-table-column>
            <el-table-column label="得分" width="120">
              <template #default="{ row }"><span class="mono">{{ row.score }} / {{ row.full }}</span></template>
            </el-table-column>
            <el-table-column label="得分率" width="110">
              <template #default="{ row }">
                <span v-if="row.rate === null" class="dim">—</span>
                <span v-else class="mono">{{ pct(row.rate) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="错题" width="90">
              <template #default="{ row }">
                <span v-if="row.wrong" class="mono">{{ row.wrong }}</span>
                <span v-else class="dim">0</span>
              </template>
            </el-table-column>
          </el-table>
          <p v-else class="dim small">这个账号还没有考试成绩。</p>
        </div>

        <!-- ④ 考情切片（学生自己传的）-->
        <div class="sec">
          <h3 class="h3">考情切片 <span class="h3__sub">学生自己上传的卷子，共 {{ ov.slices.total }} 张</span></h3>

          <div class="kpis">
            <div class="kpi">
              <b>{{ ov.slices.report.summary.count }}</b>
              <span>切片数</span>
            </div>
            <div class="kpi">
              <b>{{ ov.slices.report.summary.withScore }} / {{ ov.slices.report.summary.count }}</b>
              <span>填了分数</span>
            </div>
            <div class="kpi">
              <b>{{ ov.slices.report.summary.avgRate === null ? '—' : pct(ov.slices.report.summary.avgRate) }}</b>
              <span>平均得分率</span>
            </div>
            <div class="kpi">
              <b>{{ ov.slices.report.summary.best === null ? '—' : pct(ov.slices.report.summary.best.rate) }}</b>
              <span>最好</span>
            </div>
            <div class="kpi">
              <b>{{ ov.slices.report.summary.worst === null ? '—' : pct(ov.slices.report.summary.worst.rate) }}</b>
              <span>最差</span>
            </div>
          </div>
          <p v-if="ov.slices.report.summary.firstDate" class="dim small">
            {{ ov.slices.report.summary.firstDate }} ~ {{ ov.slices.report.summary.lastDate }}
            · 一共框了 {{ ov.slices.report.boxes.total }} 道错题，
            其中 {{ ov.slices.report.boxes.withNode }} 道挂了知识点
            <template v-if="ov.slices.report.summary.best">
              · 最好：{{ ov.slices.report.summary.best.name }}
              （{{ pct(ov.slices.report.summary.best.rate) }}）
            </template>
            <template v-if="ov.slices.report.summary.worst">
              · 最差：{{ ov.slices.report.summary.worst.name }}
              （{{ pct(ov.slices.report.summary.worst.rate) }}）
            </template>
          </p>

          <el-table v-if="ov.slices.items.length" :data="ov.slices.items" stripe size="small" class="mt">
            <el-table-column prop="name" label="名称" min-width="150" />
            <el-table-column prop="date" label="日期" width="120">
              <template #default="{ row }"><span class="mono">{{ row.date }}</span></template>
            </el-table-column>
            <el-table-column label="科目 / 卷型" min-width="130">
              <template #default="{ row }">{{ row.subject }} · {{ row.paperType }}</template>
            </el-table-column>
            <el-table-column label="得分" width="120">
              <template #default="{ row }">
                <span v-if="row.score === null" class="dim">没记分数</span>
                <span v-else class="mono">{{ row.score }} / {{ row.full }}
                  <span v-if="row.rate !== null" class="dim">（{{ pct(row.rate) }}）</span>
                </span>
              </template>
            </el-table-column>
            <el-table-column label="照片 / 错题 / 章节" width="150">
              <template #default="{ row }">
                <span class="mono">{{ row.images }} / {{ row.boxes }} / {{ row.nodes }}</span>
              </template>
            </el-table-column>
          </el-table>
          <p v-else class="dim small mt">本人还没有上传过卷子。</p>

          <template v-if="ov.slices.report.byChapter.length">
            <h4 class="h4">薄弱章节 <span class="h3__sub">按"框出来的错题数"排</span></h4>
            <ul class="chaps">
              <li v-for="c in ov.slices.report.byChapter" :key="c.nodeId">
                <span>{{ c.name }}</span>
                <span class="dim small">错题 {{ c.boxes }} 道 · 考过 {{ c.slices }} 次</span>
              </li>
            </ul>
          </template>
        </div>

        <!-- ⑤ 学习进度 -->
        <div class="sec">
          <h3 class="h3">学习进度</h3>
          <div class="kpis">
            <div class="kpi"><b>{{ ov.learning.learned }} / {{ ov.learning.records }}</b><span>已学知识点</span></div>
            <div class="kpi"><b>{{ ov.learning.masteryAvg === null ? '—' : ov.learning.masteryAvg }}</b><span>平均掌握度</span></div>
            <div class="kpi"><b>{{ ov.learning.mastered }}</b><span>已掌握（≥85）</span></div>
            <div class="kpi"><b>{{ ov.learning.events }}</b><span>学习事件</span></div>
            <div class="kpi"><b>{{ ov.learning.marks }}</b><span>标记点</span></div>
            <div class="kpi"><b>{{ ov.learning.blocked }}</b><span>前置未满足</span></div>
          </div>
          <p class="dim small mt">
            平均掌握度<strong>只按学过的那 {{ ov.learning.learned }} 个知识点算</strong> ——
            没学过的不进平均（不拿 0 顶替，和考情报告同一个口径）。
          </p>
        </div>

        <!-- ⑦ 成长曲线（S3）—— 数据全由服务端算好分桶，这里只负责画 -->
        <div v-if="growth" class="sec">
          <h3 class="h3">
            成长曲线
            <span class="h3__sub">
              按{{ growth.range.granularity === 'month' ? '月' : '周' }} ·
              区间 {{ growth.range.from.slice(0, 10) }} → {{ growth.range.to.slice(0, 10) }}
            </span>
          </h3>

          <div class="charts">
            <div class="chart">
              <div class="chart__label">掌握度推进 <span class="dim">累计平均（0~100）</span></div>
              <svg viewBox="0 0 600 150" preserveAspectRatio="none" class="svg">
                <line x1="0" y1="37.5" x2="600" y2="37.5" class="grid" />
                <line x1="0" y1="75" x2="600" y2="75" class="grid" />
                <line x1="0" y1="112.5" x2="600" y2="112.5" class="grid" />
                <polyline v-if="growthLine" :points="growthLine" class="stroke stroke--a" />
              </svg>
              <div class="chart__foot">
                末值 <b>{{ lastGrowth === null ? '—' : lastGrowth }}</b> ·
                已触及 <b>{{ lastTouched }}</b> 格
              </div>
            </div>

            <div class="chart">
              <div class="chart__label">
                学习曲线 <span class="dim">累计已学 vs 计划（共 {{ growth.progress.total }} 格）</span>
              </div>
              <svg viewBox="0 0 600 150" preserveAspectRatio="none" class="svg">
                <polyline v-if="doneLine" :points="doneLine" class="stroke stroke--a" />
                <polyline v-if="planLine" :points="planLine" class="stroke stroke--b" />
              </svg>
              <div class="chart__foot">
                <i class="dot dot--a" />已学 <b>{{ lastDone }}</b>
                <i class="dot dot--b" />计划 <b>{{ lastPlan }}</b>
                <span v-if="behind > 0" class="warn">落后计划 {{ behind }} 格</span>
                <span v-else-if="behind < 0" class="okf">超前 {{ -behind }} 格</span>
                <span v-else>与计划持平</span>
              </div>
            </div>

            <div class="chart">
              <div class="chart__label">
                成绩曲线 <span class="dim">每场考试得分率（{{ growth.scores.length }} 场）</span>
              </div>
              <svg v-if="growth.scores.length" viewBox="0 0 600 150" preserveAspectRatio="none" class="svg">
                <polyline :points="scoreLine" class="stroke stroke--a" />
                <circle v-for="(p, i) in scoreDots" :key="i" :cx="p.x" :cy="p.y" r="2.5" class="dotp" />
              </svg>
              <div v-else class="empty">这个学生还没有考试成绩。</div>
              <div class="chart__foot">
                <span v-if="growth.scores.length">
                  最近一场 <b>{{ pct(growth.scores[growth.scores.length - 1]!.rate) }}</b> ·
                  最好 <b>{{ pct(bestScore) }}</b>
                </span>
                <span v-else class="dim">—</span>
              </div>
            </div>
          </div>

          <div class="kpis mt">
            <div class="kpi">
              <b>{{ growth.practice.sessions }}</b><span>练习次数</span>
            </div>
            <div class="kpi">
              <b>{{ growth.practice.questions }}</b><span>做题数</span>
            </div>
            <div class="kpi">
              <b>{{ growth.practice.accuracy === null ? '暂无练习数据' : pct(growth.practice.accuracy) }}</b>
              <span>正确率</span>
            </div>
            <div class="kpi">
              <b>{{ growth.practice.lastAt ? when(growth.practice.lastAt) : '—' }}</b><span>最近一次练习</span>
            </div>
          </div>
          <p class="dim small mt">
            一次都没练过时正确率显示「暂无练习数据」而<strong>不是 0%</strong> —— 和原来那条"不拿 0 顶替"同一条规矩。
            正确率的<strong>分母是判得了分的题数</strong>，不是总题数：白板题（只有题面）判不了分，
            它们进「做题数」但不进分母。演示库里那几位学生的练习记录仍是<strong>造的演示数据</strong>。
          </p>

          <h4 class="h4">
            薄弱章节 · 综合
            <span class="h3__sub">错题本 + 卷面上框出的错题，按章合计</span>
          </h4>
          <p class="dim small">
            上面「考情切片」那一节里的薄弱章节<strong>只统计卷面上框出的错题</strong>（那是切片自己的报告）；
            这一张把<strong>错题本</strong>也算进来了，所以两处数字本来就不同 —— 不是哪个算错了。
          </p>
          <el-table v-if="growth.weak.length" :data="growth.weak" size="small" stripe>
            <el-table-column prop="name" label="章" min-width="200" />
            <el-table-column prop="mistakes" label="错题本" width="90" align="center" />
            <el-table-column prop="boxes" label="框出错题" width="100" align="center" />
            <el-table-column label="合计" width="90" align="center">
              <template #default="{ row }">
                <b>{{ row.mistakes + row.boxes }}</b>
              </template>
            </el-table-column>
          </el-table>
          <p v-else class="empty">还没有任何错题记录（错题本空的，也没在卷子上框过错题）。</p>
        </div>

        <!-- ⑥ 互动与内容 -->
        <div class="sec">
          <h3 class="h3">互动与内容</h3>
          <div class="kpis">
            <div class="kpi"><b>{{ ov.content.mistakes }}</b><span>错题本</span></div>
            <div class="kpi"><b>{{ ov.content.favorites }}</b><span>收藏</span></div>
            <div class="kpi"><b>{{ ov.content.notes }}</b><span>笔记</span></div>
            <div class="kpi"><b>{{ ov.content.posts }}</b><span>发帖</span></div>
            <div class="kpi"><b>{{ ov.content.replies }}</b><span>回帖</span></div>
          </div>
        </div>
        </el-tab-pane>

        <!-- 学习记录 -->
        <el-tab-pane name="learning" :label="tabLabel('学习记录', learningTotal)">
          <div class="bar">
            <el-select v-model="learningOnly" size="small" class="bar__sel" @change="reloadTab('learning')">
              <el-option label="全部（含没学过的）" value="" />
              <el-option label="只看学过的" value="learned" />
              <el-option label="只看有标记的" value="marked" />
            </el-select>
            <span class="bar__gap" />
            <el-button size="small" @click="reloadTab('learning')">刷新</el-button>
          </div>
          <el-table v-loading="busy === 'learning'" :data="learning" size="small" stripe max-height="520">
            <el-table-column label="知识点" min-width="260">
              <template #default="{ row }"><span :title="row.path">{{ row.path }}</span></template>
            </el-table-column>
            <el-table-column label="掌握度" width="90" align="right" prop="mastery" />
            <el-table-column label="状态" width="100" prop="status" />
            <el-table-column label="学习" width="110">
              <template #default="{ row }">{{ row.learnedAt || '—' }}</template>
            </el-table-column>
            <el-table-column label="复习" width="110">
              <template #default="{ row }">{{ row.reviewAt || '—' }}</template>
            </el-table-column>
            <el-table-column label="事件" width="70" align="center" prop="events" />
            <el-table-column v-if="canWrite" label="操作" width="110" align="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="editLearning(row)">改</el-button>
                <el-button link type="danger" size="small" @click="askDelete('/admin/learning-records/' + row.id, row.path)">删</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination layout="total, prev, pager, next" :total="learningTotal"
              :current-page="page.learning" :page-size="PAGE_SIZE" @current-change="turn('learning', $event)" />
          </div>
        </el-tab-pane>

        <!-- 错题本 -->
        <el-tab-pane name="mistakes" :label="tabLabel('错题本', mistakesTotal)">
          <div class="bar">
            <el-select v-model="mistakeStatus" size="small" class="bar__sel" @change="reloadTab('mistakes')">
              <el-option label="全部" value="" /><el-option label="待订正" value="open" /><el-option label="已订正" value="fixed" />
            </el-select>
            <span class="bar__gap" />
            <el-button size="small" @click="reloadTab('mistakes')">刷新</el-button>
          </div>
          <el-table v-loading="busy === 'mistakes'" :data="mistakes" size="small" stripe max-height="520">
            <el-table-column label="知识点" min-width="220">
              <template #default="{ row }">{{ row.path || row.nodeName || '—' }}</template>
            </el-table-column>
            <el-table-column label="来源" width="80">
              <template #default="{ row }">{{ row.source === 'practice' ? '练习' : '考试' }}</template>
            </el-table-column>
            <el-table-column label="考试" width="90" prop="examCode" />
            <el-table-column label="得分" width="90" align="right">
              <template #default="{ row }">{{ row.score === null ? '—' : row.score + '/' + row.full }}</template>
            </el-table-column>
            <el-table-column label="订正" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === 'fixed' ? 'success' : 'warning'">
                  {{ row.status === 'fixed' ? '已订正' : '待订正' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column v-if="canWrite" label="操作" width="110" align="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="editMistake(row)">改</el-button>
                <el-button link type="danger" size="small" @click="askDelete('/admin/mistakes/' + row.id, row.path || row.nodeName)">删</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination layout="total, prev, pager, next" :total="mistakesTotal"
              :current-page="page.mistakes" :page-size="PAGE_SIZE" @current-change="turn('mistakes', $event)" />
          </div>
        </el-tab-pane>

        <!-- 考试（可展开看卷面逐题） -->
        <el-tab-pane name="exams" :label="tabLabel('考试', exams.length)">
          <el-table v-loading="busy === 'exams'" :data="exams" size="small" stripe>
            <el-table-column type="expand">
              <template #default="{ row }">
                <el-table :data="row.papers" size="small" class="inner">
                  <el-table-column label="题号" width="70" prop="index" />
                  <el-table-column label="知识点" min-width="220">
                    <template #default="{ row: p }">{{ p.path || '—' }}</template>
                  </el-table-column>
                  <el-table-column label="得分" width="120" align="right">
                    <template #default="{ row: p }">{{ p.score }} / {{ p.full }}</template>
                  </el-table-column>
                  <el-table-column label="错因" min-width="140">
                    <template #default="{ row: p }">
                      <span v-if="p.causes && p.causes.length">{{ p.causes.map(c => c.key).join('、') }}</span>
                      <span v-else class="dim">—</span>
                    </template>
                  </el-table-column>
                  <el-table-column v-if="canWrite" label="操作" width="80" align="right">
                    <template #default="{ row: p }">
                      <el-button link type="primary" size="small" @click="editPaper(row, p)">改</el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </template>
            </el-table-column>
            <el-table-column label="考试" min-width="200" prop="name" />
            <el-table-column label="日期" width="110" prop="date" />
            <el-table-column label="得分" width="120" align="right">
              <template #default="{ row }">{{ row.score }} / {{ row.full }}</template>
            </el-table-column>
            <el-table-column label="得分率" width="90" align="right">
              <template #default="{ row }">{{ row.rate === null ? '—' : Math.round(row.rate * 100) + '%' }}</template>
            </el-table-column>
            <el-table-column v-if="canWrite" label="操作" width="80" align="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="editExam(row)">改</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 练习（不可改，只能整次删） -->
        <el-tab-pane name="practice" :label="tabLabel('练习', practiceTotal)">
          <p class="dim small">
            练习记录<strong>不能改</strong> —— 那是"当时做了什么"的历史，改它就是伪造历史。
            要作废只能整次删掉，删了学生可以重练。
          </p>
          <p class="dim small">
            「做了」= 这次真做了几道（白板题里没标记「做完了」的服务器会整条撤掉，不算）；
            「判分」= 其中判得了分的几道 —— <strong>正确率的分母是它</strong>；
            白板题（kind=board）只有题面、没有标准答案，记「做了」但<strong>不判错</strong>。
          </p>
          <el-table v-loading="busy === 'practice'" :data="practice" size="small" stripe>
            <el-table-column type="expand">
              <template #default="{ row }">
                <el-table :data="row.answers" size="small" class="inner">
                  <el-table-column label="题" width="70" prop="code" />
                  <el-table-column label="题干" min-width="240">
                    <template #default="{ row: a }"><span v-html="a.stem" /></template>
                  </el-table-column>
                  <el-table-column label="作答" width="110" prop="given" />
                  <el-table-column label="正确" width="90">
                    <template #default="{ row: a }">
                      <el-tag v-if="a.correct === null" size="small" type="info">不判分</el-tag>
                      <el-tag v-else size="small" :type="a.correct ? 'success' : 'danger'">{{ a.correct ? '对' : '错' }}</el-tag>
                    </template>
                  </el-table-column>
                </el-table>
              </template>
            </el-table-column>
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ when(row.submittedAt || row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="做了" width="80" align="right" prop="total" />
            <el-table-column label="判分" width="80" align="right" prop="judged" />
            <el-table-column label="判对" width="80" align="right" prop="correct" />
            <el-table-column label="得分" width="80" align="right">
              <template #default="{ row }">{{ row.score === null ? '—' : row.score }}</template>
            </el-table-column>
            <el-table-column v-if="canWrite" label="操作" width="80" align="right">
              <template #default="{ row }">
                <el-button link type="danger" size="small" @click="askDelete('/admin/practice-sessions/' + row.id, '练习 #' + row.id)">删</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination layout="total, prev, pager, next" :total="practiceTotal"
              :current-page="page.practice" :page-size="PAGE_SIZE" @current-change="turn('practice', $event)" />
          </div>
        </el-tab-pane>

        <!-- 上传的卷子 -->
        <el-tab-pane name="slices" :label="tabLabel('上传的卷子', slices.length)">
          <el-table v-loading="busy === 'slices'" :data="slices" size="small" stripe>
            <el-table-column label="名称" min-width="200" prop="name" />
            <el-table-column label="日期" width="110" prop="date" />
            <el-table-column label="科目/卷型" min-width="140">
              <template #default="{ row }">{{ row.subject }} · {{ row.paperType }}</template>
            </el-table-column>
            <el-table-column label="得分" width="120" align="right">
              <template #default="{ row }">
                {{ row.score === null && row.full === null ? '未填' : (row.score ?? '—') + ' / ' + (row.full ?? '—') }}
              </template>
            </el-table-column>
            <el-table-column label="框出错题" width="100" align="center">
              <template #default="{ row }">{{ row.boxes.length }}</template>
            </el-table-column>
            <el-table-column v-if="canWrite" label="操作" width="110" align="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="editSlice(row)">改</el-button>
                <el-button link type="danger" size="small" @click="askDelete('/admin/exam-slices/' + row.id, row.name)">删</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 笔记与收藏 -->
        <el-tab-pane name="notes" :label="tabLabel('笔记与收藏', notes.length + favorites.length)">
          <h4 class="h4">笔记</h4>
          <el-table v-loading="busy === 'notes'" :data="notes" size="small" stripe>
            <el-table-column label="标题" min-width="180" prop="title" />
            <el-table-column label="挂在哪" min-width="220">
              <template #default="{ row }">{{ row.path || '—' }}</template>
            </el-table-column>
            <el-table-column label="更新" width="170">
              <template #default="{ row }">{{ when(row.updatedAt) }}</template>
            </el-table-column>
            <el-table-column v-if="canWrite" label="操作" width="110" align="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="editNote(row)">改</el-button>
                <el-button link type="danger" size="small" @click="askDelete('/admin/notes/' + row.id, row.title)">删</el-button>
              </template>
            </el-table-column>
          </el-table>

          <h4 class="h4">收藏</h4>
          <el-table v-loading="busy === 'notes'" :data="favorites" size="small" stripe>
            <el-table-column label="标题" min-width="220" prop="title" />
            <el-table-column label="类型" width="110" prop="kind" />
            <el-table-column label="收藏于" width="170">
              <template #default="{ row }">{{ when(row.createdAt) }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 变更记录 -->
        <el-tab-pane name="changes" :label="tabLabel('变更记录', changeTotal)">
          <p class="dim small">
            后台改这个学生的数据都会记在这里。<strong>同一次保存产生的几行共用一个批次号</strong>，所以能看成"一次操作"。
          </p>
          <el-table v-loading="busy === 'changes'" :data="changes" size="small" stripe>
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ when(row.at) }}</template>
            </el-table-column>
            <el-table-column label="谁改的" width="120" prop="actorName" />
            <el-table-column label="改的什么" min-width="240">
              <template #default="{ row }">{{ row.label }}</template>
            </el-table-column>
            <el-table-column label="字段" width="110" prop="field" />
            <el-table-column label="改动" min-width="200">
              <template #default="{ row }">
                <span class="dim">{{ row.oldValue === null ? '（空）' : row.oldValue }}</span>
                <span> → </span>
                <b>{{ row.newValue === null ? '（删除）' : row.newValue }}</b>
              </template>
            </el-table-column>
            <el-table-column label="原因" min-width="160">
              <template #default="{ row }">
                <span v-if="row.reason">{{ row.reason }}</span>
                <span v-else class="dim">未填</span>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination layout="total, prev, pager, next" :total="changeTotal"
              :current-page="page.changes" :page-size="PAGE_SIZE" @current-change="turn('changes', $event)" />
          </div>
        </el-tab-pane>
        </el-tabs>
      </template>
    </el-card>

    <!-- 通用编辑弹窗：六种实体共用一张表单，省得写六个对话框 -->
    <el-dialog v-model="editor.show" :title="editor.title" width="520px" :close-on-click-modal="false">
      <el-form label-width="90px">
        <el-form-item v-for="f in editor.fields" :key="f.key" :label="f.label">
          <el-input v-if="f.type === 'text'" v-model="editor.values[f.key]" :maxlength="191" />
          <el-input v-else-if="f.type === 'textarea'" v-model="editor.values[f.key]" type="textarea" :rows="4" />
          <el-input-number v-else-if="f.type === 'number'" v-model="editor.values[f.key]" :min="f.min ?? 0" :max="f.max ?? 1000" controls-position="right" />
          <el-select v-else-if="f.type === 'select'" v-model="editor.values[f.key]" class="w100">
            <el-option v-for="o in f.options" :key="String(o.value)" :label="o.label" :value="o.value" />
          </el-select>
          <el-input v-else-if="f.type === 'date'" v-model="editor.values[f.key]" placeholder="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="为什么改">
          <el-input v-model="editor.reason" maxlength="191" placeholder="一句就够，会记进变更记录" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editor.show = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEditor">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, reactive, watch } from 'vue';
/* E4 起这一页要弹提示、要确认框了 —— 原来只读时不需要，所以从来没引过 */
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import { api, can, type ApiError } from '../api';

type OrderRow = {
  orderNo: string; planCode: string; planName: string; amountCents: number;
  status: string; channel: string; channelName: string; isTest: boolean;
  createdAt: string; paidAt: string | null;
};
type ExamRow = {
  code: string; name: string; date: string; score: number; full: number;
  rate: number | null; wrong: number;
};
type SliceRow = {
  id: number; name: string; date: string; subject: string; paperType: string;
  score: number | null; full: number | null; rate: number | null; note: string | null;
  images: number; boxes: number; nodes: number;
};
type ChapRow = { nodeId: number; name: string; boxes: number; slices: number };
/** 成绩走向上的一个点。`best` / `worst` 不是数，是**这张切片本身** ——
    所以取分要 `.rate`，直接把对象丢给 pct() 会算出 NaN%。 */
type TrendPoint = {
  sliceId: number; date: string; name: string; subject: string;
  score: number; full: number; rate: number;
};
type Overview = {
  user: {
    id: number; username: string; nickname: string; grade: string | null;
    role: string; createdAt: string; disabledAt: string | null;
  };
  membership: {
    planCode: string | null; planName: string | null;
    isMember: boolean; endAt: string | null; daysLeft: number | null;
  };
  orders: OrderRow[];
  exams: ExamRow[];
  slices: {
    total: number; items: SliceRow[];
    report: {
      summary: {
        count: number; withScore: number; firstDate: string | null;
        lastDate: string | null; avgRate: number | null;
        best: TrendPoint | null; worst: TrendPoint | null;
      };
      byChapter: ChapRow[];
      boxes: { total: number; withNode: number; withoutNode: number };
    };
  };
  learning: {
    records: number; learned: number; mastered: number; masteryAvg: number | null;
    events: number; marks: number; blocked: number;
  };
  content: {
    mistakes: number; mistakesOpen: number; favorites: number;
    notes: number; posts: number; replies: number;
  };
};

const route = useRoute();
const router = useRouter();
const ov = ref<Overview | null>(null);
/** 成长数据另取一次 —— 它比 overview 重（要扫全部事件），不该让整页等它 */
const growth = ref<Growth | null>(null);
const error = ref('');
const loading = ref(false);

type Growth = {
  student: { id: number; nickname: string; stage: string | null; className: string | null };
  range: { from: string; to: string; granularity: string };
  growth: { key: string; masteryAvg: number | null; touched: number; events: number }[];
  progress: { buckets: { key: string; done: number; plan: number }[]; total: number };
  scores: { code: string; name: string; date: string; score: number; full: number; rate: number | null }[];
  practice: { sessions: number; questions: number; correct: number; judged: number; accuracy: number | null; lastAt: string | null };
  weak: { nodeId: number; name: string; mistakes: number; boxes: number }[];
};

/** 一条折线拉成 viewBox 里的点串。
    纵轴固定 0~max；**起点之前的 null 要跳过** —— 那时候还没有任何记录，
    画成 0 就成了"掌握度是 0"，而事实是"还没有这一格"。 */
function line(vals: (number | null)[], max: number, w = 600, h = 150): string {
  const firstReal = vals.findIndex((v) => v !== null);
  if (firstReal < 0) { return ''; }
  const slice = vals.slice(firstReal);
  const n = slice.length;
  return slice
    .map((v, i) => {
      const x = n === 1 ? 0 : (i / (n - 1)) * w;
      const y = h - ((v ?? 0) / (max || 1)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const growthLine = computed(() => growth.value
  ? line(growth.value.growth.map((g) => g.masteryAvg), 100) : '');
const lastGrowth = computed(() => {
  const arr = growth.value?.growth ?? [];
  for (let i = arr.length - 1; i >= 0; i -= 1) { if (arr[i]!.masteryAvg !== null) { return arr[i]!.masteryAvg; } }
  return null;
});
const lastTouched = computed(() => {
  const arr = growth.value?.growth ?? [];
  for (let i = arr.length - 1; i >= 0; i -= 1) { if (arr[i]!.touched > 0) { return arr[i]!.touched; } }
  return 0;
});

const doneLine = computed(() => growth.value
  ? line(growth.value.progress.buckets.map((b) => b.done), growth.value.progress.total) : '');
const planLine = computed(() => growth.value
  ? line(growth.value.progress.buckets.map((b) => b.plan), growth.value.progress.total) : '');
const lastDone = computed(() => growth.value?.progress.buckets.at(-1)?.done ?? 0);
const lastPlan = computed(() => growth.value?.progress.buckets.at(-1)?.plan ?? 0);
/** 正数 = 落后计划；负数 = 超前。用末桶比，中间桶的比较没有意义 */
const behind = computed(() => lastPlan.value - lastDone.value);

const scoreLine = computed(() => growth.value
  ? line(growth.value.scores.map((s) => s.rate), 1) : '');
const scoreDots = computed(() => {
  const arr = growth.value?.scores ?? [];
  const n = arr.length;
  return arr.map((s, i) => ({
    x: n === 1 ? 0 : (i / (n - 1)) * 600,
    y: 150 - ((s.rate ?? 0) / 1) * 150,
  }));
});
const bestScore = computed(() => {
  const arr = (growth.value?.scores ?? []).map((s) => s.rate).filter((r): r is number => r !== null);
  return arr.length ? Math.max(...arr) : null;
});

/** 真实收款：**测试通道的单不算** —— 和订单页同一个口径，不在这里另定一套。 */
const paidCents = computed(() => (ov.value?.orders ?? [])
  .filter((o) => o.status === 'paid' && !o.isTest)
  .reduce((s, o) => s + o.amountCents, 0));

function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}
function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
/** 库里存的是 ISO 时间；直接摆给人看太生硬，换成"2026-10-05 22:31"。 */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return iso; }
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function statusName(s: string): string {
  return ({ paid: '已支付', pending: '待支付', canceled: '已取消', expired: '已超时' } as Record<string, string>)[s] ?? s;
}
function statusType(s: string): 'success' | 'warning' | 'info' | 'danger' {
  if (s === 'paid') { return 'success'; }
  if (s === 'pending') { return 'warning'; }
  return 'info';
}
function back(): void {
  void router.push('/users');
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const id = String(route.params.id);
    /* 两个一起发，但**失败互不牵连**：growth 拉不到不该把整页弄空 */
    const [ovGot, growthGot] = await Promise.all([
      api<Overview>(`/admin/users/${id}/overview`),
      api<Growth>(`/admin/students/${id}/growth`).catch(() => null),
    ]);
    ov.value = ovGot;
    growth.value = growthGot;
    error.value = '';
  } catch (e) {
    error.value = (e as ApiError).message;
    ov.value = null;
  } finally {
    loading.value = false;
  }
}

/* ==================================================================
 * 明细 tab（E4）
 * ------------------------------------------------------------------
 * 接口在 E2 / E3 就有了，这一半是把它们摆到界面上：
 * **能看明细**（以前后台只有一个"错题 158"这样的计数）、
 * **能改**（修正型：改已存在的数据、能删；不提供造数入口）。
 *
 * 每一次保存都会多一条「变更记录」—— 改的人、从多少到多少、为什么。
 * 所以页头写着"学生端立刻可见"：改了掌握度，成长曲线当场就变。
 * ================================================================== */
type Tab = 'overview' | 'learning' | 'mistakes' | 'exams' | 'practice' | 'slices' | 'notes' | 'changes';

const PAGE_SIZE = 20;
const tab = ref<Tab>('overview');
const busy = ref<Tab | null>(null);
const saving = ref(false);
const canWrite = computed(() => can('student.write'));

const learning = ref<{ id: number; path: string; mastery: number; status: string; learnedAt: string | null; reviewAt: string | null; plannedAt: string | null; term: string | null; events: number }[]>([]);
const learningTotal = ref(0);
const learningOnly = ref('');

const mistakes = ref<{ id: number; path: string; nodeName: string; source: string; examCode: string | null; score: number | null; full: number | null; status: string }[]>([]);
const mistakesTotal = ref(0);
const mistakeStatus = ref('');

const exams = ref<{ id: number; code: string; name: string; date: string; score: number; full: number; rate: number | null; papers: { id: number; index: number; path: string; score: number; full: number; causes: { key: string }[] | null }[] }[]>([]);

const practice = ref<{ id: number; total: number; correct: number | null; judged: number | null; score: number | null; submittedAt: string | null; createdAt: string; answers: { id: number; code: string; stem: string; given: string | null; correct: boolean | null }[] }[]>([]);
const practiceTotal = ref(0);

const slices = ref<{ id: number; name: string; date: string; subject: string; paperType: string; score: number | null; full: number | null; note: string | null; boxes: unknown[] }[]>([]);
const notes = ref<{ id: number; title: string; body: string; path: string; updatedAt: string }[]>([]);
const favorites = ref<{ id: number; kind: string; title: string; createdAt: string }[]>([]);
const changes = ref<{ id: number; batchId: string; actorName: string; label: string; field: string; oldValue: string | null; newValue: string | null; reason: string | null; at: string }[]>([]);
const changeTotal = ref(0);

/** 每个 tab 各自记页码 —— 在一个 tab 翻到第 3 页，切走再回来还在第 3 页 */
const page = reactive<Record<string, number>>({
  learning: 1, mistakes: 1, practice: 1, changes: 1,
});

function sid(): string { return String(route.params.id); }
function tabLabel(name: string, n: number): string { return n ? name + '（' + n + '）' : name; }

async function loadLearning(): Promise<void> {
  busy.value = 'learning';
  try {
    const p = new URLSearchParams({ pageSize: String(PAGE_SIZE), page: String(page.learning) });
    if (learningOnly.value) { p.set('only', learningOnly.value); }
    const d = await api<{ total: number; items: typeof learning.value }>(`/admin/students/${sid()}/learning?${p}`);
    learning.value = d.items; learningTotal.value = d.total;
  } catch (e) { error.value = (e as ApiError).message; } finally { busy.value = null; }
}

async function loadMistakes(): Promise<void> {
  busy.value = 'mistakes';
  try {
    const p = new URLSearchParams({ pageSize: String(PAGE_SIZE), page: String(page.mistakes) });
    if (mistakeStatus.value) { p.set('status', mistakeStatus.value); }
    const d = await api<{ total: number; items: typeof mistakes.value }>(`/admin/students/${sid()}/mistakes?${p}`);
    mistakes.value = d.items; mistakesTotal.value = d.total;
  } catch (e) { error.value = (e as ApiError).message; } finally { busy.value = null; }
}

async function loadExams(): Promise<void> {
  busy.value = 'exams';
  try {
    exams.value = (await api<{ items: typeof exams.value }>(`/admin/students/${sid()}/exams`)).items;
  } catch (e) { error.value = (e as ApiError).message; } finally { busy.value = null; }
}

async function loadPractice(): Promise<void> {
  busy.value = 'practice';
  try {
    const p = new URLSearchParams({ pageSize: String(PAGE_SIZE), page: String(page.practice) });
    const d = await api<{ total: number; items: typeof practice.value }>(`/admin/students/${sid()}/practice?${p}`);
    practice.value = d.items; practiceTotal.value = d.total;
  } catch (e) { error.value = (e as ApiError).message; } finally { busy.value = null; }
}

async function loadSlices(): Promise<void> {
  busy.value = 'slices';
  try {
    slices.value = (await api<{ items: typeof slices.value }>(`/admin/students/${sid()}/slices`)).items;
  } catch (e) { error.value = (e as ApiError).message; } finally { busy.value = null; }
}

async function loadNotes(): Promise<void> {
  busy.value = 'notes';
  try {
    const [n, f] = await Promise.all([
      api<{ items: typeof notes.value }>(`/admin/students/${sid()}/notes`),
      api<{ items: typeof favorites.value }>(`/admin/students/${sid()}/favorites`),
    ]);
    notes.value = n.items; favorites.value = f.items;
  } catch (e) { error.value = (e as ApiError).message; } finally { busy.value = null; }
}

async function loadChanges(): Promise<void> {
  busy.value = 'changes';
  try {
    const p = new URLSearchParams({ pageSize: String(PAGE_SIZE), page: String(page.changes) });
    const d = await api<{ total: number; items: typeof changes.value }>(`/admin/students/${sid()}/changes?${p}`);
    changes.value = d.items; changeTotal.value = d.total;
  } catch (e) { error.value = (e as ApiError).message; } finally { busy.value = null; }
}

const LOADERS: Record<string, () => Promise<void>> = {
  learning: loadLearning, mistakes: loadMistakes, exams: loadExams,
  practice: loadPractice, slices: loadSlices, notes: loadNotes, changes: loadChanges,
};

/** 每个 tab 第一次点开才取数 —— 一进页面就把 8 个接口全打一遍是没必要的 */
function reloadTab(t: string): void { void (LOADERS[t] ?? (async () => undefined))(); }

/** 翻页 / 换筛选之后，数据变了，变更记录也要跟着刷新（改动都是从这里发起的） */
function turn(t: string, n: number): void {
  page[t] = n;
  reloadTab(t);
}

/* ---------------- 通用编辑器 ---------------- */
type FieldDef = {
  key: string; label: string;
  type: 'text' | 'number' | 'select' | 'date' | 'textarea';
  options?: { label: string; value: unknown }[];
  min?: number; max?: number;
};

const editor = reactive<{
  show: boolean; title: string; url: string;
  fields: FieldDef[];
  values: Record<string, unknown>;
  reason: string;
}>({ show: false, title: '', url: '', fields: [], values: {}, reason: '' });

function openEditor(title: string, url: string, fields: FieldDef[], values: Record<string, unknown>, back: Tab): void {
  editor.title = title;
  editor.url = url;
  editor.fields = fields;
  editor.values = { ...values };
  editor.reason = '';
  editor.show = true;
  /* 保存后要刷新的 tab —— 顺手也刷一下变更记录 */
  editorBack = back;
}
let editorBack: Tab = 'overview';

async function saveEditor(): Promise<void> {
  saving.value = true;
  try {
    const r = await api<{ ok: true; changed: string[] }>(editor.url, {
      method: 'PATCH',
      body: JSON.stringify({ ...editor.values, reason: editor.reason || null }),
    });
    ElMessage.success('已保存：' + r.changed.join('、'));
    editor.show = false;
    reloadTab(editorBack);
    reloadTab('changes');
  } catch (e) {
    /* 400 NO_CHANGE 是最常见的一种 —— 服务端说得已经很清楚了，照原话显示 */
    ElMessage.error((e as ApiError).message);
  } finally { saving.value = false; }
}

/* ---------------- 删除 ---------------- */
/* 删比改危险：删学习记录会连带删掉它的学习事件，而那正是成长曲线的原始数据。
   服务端会把连带删了多少条回过来，这里如实报给人看。 */
async function askDelete(url: string, label: string): Promise<void> {
  let reason = '';
  try {
    const r = await ElMessageBox.prompt(
      `删掉「${label}」？这个动作会记进变更记录，${editorBack === 'learning' ? '并且会连带删掉属于它的学习事件。' : '不可恢复。'}`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '算了', inputPlaceholder: '为什么删（可留空）' },
    );
    reason = r.value || '';
  } catch { return; }

  try {
    const got = await api<{ ok: true; deletedEvents?: number; deletedImages?: number }>(url, {
      method: 'DELETE',
      body: JSON.stringify({ reason: reason || null }),
    });
    const extra = got.deletedEvents ? `（连带删了 ${got.deletedEvents} 条学习事件）` : '';
    ElMessage.success('已删除' + extra);
    reloadTab(tab.value);
    reloadTab('changes');
  } catch (e) {
    ElMessage.error((e as ApiError).message);
  }
}

/* ---------------- 各自的"改"入口 ---------------- */
const STATUS_OPTS = ['未开始', '学习中', '初步掌握', '已掌握', '精通', '待复习']
  .map((v) => ({ label: v, value: v }));

function editLearning(r: (typeof learning.value)[number]): void {
  openEditor('改学习记录', `/admin/learning-records/${r.id}`, [
    { key: 'mastery', label: '掌握度', type: 'number', min: 0, max: 100 },
    { key: 'status', label: '状态', type: 'select', options: STATUS_OPTS },
    { key: 'learnedAt', label: '学习日期', type: 'date' },
    { key: 'reviewAt', label: '复习日期', type: 'date' },
    { key: 'plannedAt', label: '计划日期', type: 'date' },
    { key: 'term', label: '学期', type: 'text' },
  ], {
    mastery: r.mastery, status: r.status,
    learnedAt: r.learnedAt, reviewAt: r.reviewAt, plannedAt: r.plannedAt, term: r.term,
  }, 'learning');
}

function editMistake(r: (typeof mistakes.value)[number]): void {
  openEditor('改错题', `/admin/mistakes/${r.id}`, [
    { key: 'status', label: '订正状态', type: 'select', options: [
      { label: '待订正', value: 'open' }, { label: '已订正', value: 'fixed' },
    ] },
  ], { status: r.status }, 'mistakes');
}

function editPaper(exam: (typeof exams.value)[number], p: (typeof exams.value)[number]['papers'][number]): void {
  openEditor(`改卷面题：${exam.name} 第 ${p.index} 题`, `/admin/exam-papers/${p.id}`, [
    { key: 'score', label: '得分', type: 'number' },
    { key: 'full', label: '满分', type: 'number' },
  ], { score: p.score, full: p.full }, 'exams');
}

function editExam(r: (typeof exams.value)[number]): void {
  openEditor('改考试', `/admin/exams/${r.id}`, [
    { key: 'name', label: '考试名', type: 'text' },
    { key: 'date', label: '日期', type: 'date' },
    { key: 'scope', label: '类型', type: 'text' },
  ], { name: r.name, date: r.date }, 'exams');
}

function editSlice(r: (typeof slices.value)[number]): void {
  openEditor('改上传的卷子', `/admin/exam-slices/${r.id}`, [
    { key: 'name', label: '名称', type: 'text' },
    { key: 'date', label: '日期', type: 'date' },
    { key: 'score', label: '得分', type: 'number' },
    { key: 'full', label: '满分', type: 'number' },
    { key: 'note', label: '备注', type: 'textarea' },
  ], { name: r.name, date: r.date, score: r.score, full: r.full, note: r.note }, 'slices');
}

function editNote(r: (typeof notes.value)[number]): void {
  openEditor('改笔记', `/admin/notes/${r.id}`, [
    { key: 'title', label: '标题', type: 'text' },
    { key: 'body', label: '正文', type: 'textarea' },
  ], { title: r.title, body: r.body }, 'notes');
}

/* 切到哪个 tab 就取哪个 tab 的数（只取一次，之后的刷新靠各自的按钮） */
const loaded = new Set<string>();
watch(tab, (t) => {
  if (t === 'overview' || loaded.has(t)) { return; }
  loaded.add(t);
  reloadTab(t);
});

onMounted(load);
</script>

<style scoped>
.ud { max-width: 1100px; }
.mb { margin-bottom: 12px; }
.mt { margin-top: 12px; }
.ml { margin-left: 6px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.head__note { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }

.who { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.who__name { font-size: 18px; font-weight: 600; color: var(--admin-ink); }

.sec { margin-top: 22px; }
.h3 { margin: 0 0 10px; font-size: 14px; font-weight: 600; color: var(--admin-ink); }
.h4 { margin: 18px 0 8px; font-size: 13px; font-weight: 600; color: var(--admin-ink); }
.h3__sub { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }

.kpis { display: flex; flex-wrap: wrap; gap: 26px; }
.kpi { display: flex; flex-direction: column; gap: 2px; }
.kpi b { font-size: 20px; font-weight: 600; color: var(--admin-ink); font-variant-numeric: tabular-nums; }
.kpi span { font-size: 12px; color: var(--admin-ink-3); }

.chaps { margin: 0; padding: 0; list-style: none; }
.chaps li {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 7px 0; border-bottom: 1px solid var(--admin-line-soft); font-size: 13px;
  color: var(--admin-ink-2);
}

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.dim { color: var(--admin-ink-3); }

/* ---------- 成长曲线（S3）---------- */
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.chart { border: 1px solid var(--admin-border, #e4e7ed); border-radius: 8px; padding: 12px; }
.chart__label { font-size: 12px; font-weight: 600; margin-bottom: 8px; }
.chart__foot { font-size: 12px; color: var(--admin-ink-3); margin-top: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.svg { width: 100%; height: 150px; display: block; }
.svg .grid { stroke: var(--admin-border, #e4e7ed); stroke-width: 1; stroke-dasharray: 3 4; }
/* preserveAspectRatio=none 会把线宽一起拉变形，所以要 non-scaling-stroke */
.svg .stroke { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.stroke--a { stroke: var(--el-color-primary); }
.stroke--b { stroke: var(--el-color-warning); stroke-dasharray: 6 4; }
.dotp { fill: var(--el-color-primary); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
.dot--a { background: var(--el-color-primary); }
.dot--b { background: var(--el-color-warning); }
.warn { color: var(--el-color-danger); }
.okf { color: var(--el-color-success); }
.h4 { font-size: 13px; font-weight: 600; margin: 20px 0 8px; }
.empty { padding: 16px 0; font-size: 13px; color: var(--admin-ink-3); }

/* ---------- 明细 tab（E4）---------- */
.udtabs { margin-top: 4px; }
.bar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.bar__sel { width: 200px; }
.bar__gap { flex: 1; }
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }
.h4 { font-size: 13px; font-weight: 600; margin: 18px 0 8px; }
.w100 { width: 100%; }
.inner { margin: 0 0 0 48px; width: auto; }
.small { font-size: 12px; line-height: 1.8; }
</style>
