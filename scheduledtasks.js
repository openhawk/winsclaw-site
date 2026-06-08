/**
* Scheduled business task runner.
*/
"use strict";

module.exports.CreateScheduledTaskManager = function (parent, db) {
    const crypto = require('crypto');
    const obj = {};
    obj.running = {};
    obj.scanTimer = null;
    obj.recoveryTimer = null;

    function makeId(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(5).toString('hex'); }
    function dbPromise(name) {
        const args = Array.prototype.slice.call(arguments, 1);
        return new Promise(function (resolve, reject) {
            args.push(function (err, result) { if (err != null) reject(err); else resolve(result); });
            db[name].apply(db, args);
        });
    }
    function jsonField(value, fallback) {
        if (value == null) return fallback;
        if (typeof value === 'object') return value;
        try { return JSON.parse(String(value)); } catch (ex) { return fallback; }
    }
    function cloneJson(value) { return JSON.parse(JSON.stringify(value == null ? {} : value)); }
    function text(value, maxLen) {
        if (value == null) return '';
        value = String(value).trim();
        return value.length > maxLen ? value.substring(0, maxLen) : value;
    }
    function defaultProjectRoot(deviceOs) {
        return deviceOs === 'windows' ? 'D:\\winsclaw-work\\aibot' : '/Users/<user>/Documents/ai-bot';
    }
    function defaultFlowScriptPath(flowType, deviceOs) {
        const base = defaultProjectRoot(deviceOs);
        if (deviceOs === 'windows') {
            if (flowType === 'pricing') return base + '\\app\\pricing.py';
            if (flowType === 'auto_reply') return base + '\\scripts\\run-resident-auto-reply.ps1';
            return base + '\\app\\cli.py';
        }
        if (flowType === 'pricing') return base + '/app/pricing.py';
        if (flowType === 'auto_reply') return base + '/scripts-mac/run-resident-auto-reply.sh';
        return base + '/app/cli.py';
    }
    function normalizeFlowScriptPath(flow, scriptPath) {
        const flowType = flow.flow_type || flow.flowType;
        const deviceOs = flow.device_os || flow.deviceOs || 'windows';
        let value = text(scriptPath, 2048);
        if (value === '') return defaultFlowScriptPath(flowType, deviceOs);
        const normalized = value.replace(/\\/g, '/').toLowerCase();
        if (flowType === 'publish' && normalized.endsWith('/scripts/run-publish-product.ps1')) {
            return value.substring(0, value.length - 'scripts/run-publish-product.ps1'.length) + (value.indexOf('\\') >= 0 ? 'app\\cli.py' : 'app/cli.py');
        }
        if (flowType === 'pricing' && normalized.endsWith('/scripts/run-pricing.ps1')) {
            return value.substring(0, value.length - 'scripts/run-pricing.ps1'.length) + (value.indexOf('\\') >= 0 ? 'app\\pricing.py' : 'app/pricing.py');
        }
        return value;
    }
    function normalizeCollectScriptPath(task, scriptPath) {
        const collectType = task.collect_type || task.collectType;
        let value = text(scriptPath, 2048);
        if (collectType !== 'collect_shop') return value;
        const normalized = value.replace(/\\/g, '/').toLowerCase();
        if (normalized.endsWith('/scripts/run-collect-shop.ps1')) {
            return value.substring(0, value.length - 'scripts/run-collect-shop.ps1'.length) + (value.indexOf('\\') >= 0 ? 'app\\collect_shop.py' : 'app/collect_shop.py');
        }
        return value;
    }
    function arrayField(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch (ex) { return []; } }
        return [];
    }
    function numberOrNull(value) {
        if (value == null || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    function parseCollectData(output) {
        const trimmed = String(output || '').trim();
        if (trimmed === '') return [];
        let match = trimmed.match(/__COLLECT_DATA_JSON_START__\s*([\s\S]*?)\s*__COLLECT_DATA_JSON_END__/);
        const candidates = [];
        if (match) candidates.push(match[1]);
        candidates.push(trimmed);
        const arrayMatch = trimmed.match(/(\[[\s\S]*\])\s*$/);
        if (arrayMatch) candidates.push(arrayMatch[1]);
        for (let i = 0; i < candidates.length; i++) {
            try {
                const parsed = JSON.parse(candidates[i]);
                if (Array.isArray(parsed)) return parsed;
                if (parsed && Array.isArray(parsed.data)) return parsed.data;
            } catch (ex) { }
        }
        return [];
    }
    function summarizeOutput(stdout, stderr, maxLen) {
        const joined = [stdout || '', stderr || ''].join('\n').trim();
        if (joined === '') return '';
        maxLen = maxLen || 4096;
        return joined.length > maxLen ? joined.substring(0, maxLen) : joined;
    }
    function resultSummary(status, exitCode) {
        if (status === 'running') return '流程已启动，等待停止或心跳更新。';
        if (status === 'success') return '执行成功，退出码 ' + String(exitCode == null ? 0 : exitCode) + '。';
        if (status === 'manual_required') return '执行完成，但需要人工处理。';
        return '执行失败，退出码 ' + String(exitCode == null ? -1 : exitCode) + '。';
    }
    function todayParts(timezone) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
        const map = {};
        for (let i = 0; i < parts.length; i++) map[parts[i].type] = parts[i].value;
        return { date: map.year + '-' + map.month + '-' + map.day, time: map.hour + ':' + map.minute };
    }
    async function resolveCollectResult(reference, collectType, options) {
        options = options || {};
        let result = null;
        if (reference && reference.collectResultId) result = await dbPromise('GetCollectResult', reference.collectResultId);
        else if (reference && reference.collectTaskId) result = await dbPromise('GetLatestCollectResult', reference.collectTaskId, collectType, options.maxAgeDays, options.requireSyncSuccess === true);
        else result = await dbPromise('GetLatestCollectResult', null, collectType, options.maxAgeDays, options.requireSyncSuccess === true);
        if (result == null) throw new Error(options.notFoundMessage || '未找到可用的采集结果。');
        if (result.collect_type !== collectType) throw new Error('采集结果类型不匹配。');
        if (result.status !== 'success') throw new Error('采集结果状态不是 success。');
        if ((options.requireSyncSuccess === true) && (result.sync_status !== 'success')) throw new Error('采集结果尚未成功同步标准化商品数据。');
        return result;
    }
    function applyFlowContext(config, flow) {
        config._meshFlow = config._meshFlow || {};
        config._meshFlow.flowId = flow.id;
        config._meshFlow.flowType = flow.flow_type || flow.flowType;
        config._meshFlow.myShopId = flow.my_shop_id || flow.myShopId || '';
        config._meshFlow.myShopName = flow.my_shop_name || flow.myShopName || '';
        config._meshFlow.shopCategory = flow.shop_category || flow.shopCategory || '';
        config._meshFlow.productName = flow.product_name || flow.productName || '';
        config._meshFlow.myProductName = flow.my_product_name || flow.myProductName || '';
        config.myShopId = flow.my_shop_id || flow.myShopId || '';
        config.myShopName = flow.my_shop_name || flow.myShopName || '';
        config.shopCategory = flow.shop_category || flow.shopCategory || '';
        config.productName = flow.product_name || flow.productName || '';
        config.myProductName = flow.my_product_name || flow.myProductName || '';
        return config;
    }
    function normalizeAutoReplyConfig(config) {
        const cloned = cloneJson(config || {});
        cloned.autoReply = cloned.autoReply || {};
        if (!cloned.autoReply.replyText || cloned.autoReply.replyText === '您好') {
            cloned.autoReply.replyText = '感谢您对本店的信任与支持';
        }
        return cloned;
    }
    function normalizePublishCategoryPath(value) { const path = arrayField(value); return path.length === 0 ? ['花卉园艺', '礼品花', '礼品鲜花'] : path; }
    function publishStoreCategoryPath(flow, product) {
        const shopCategory = text(flow.shop_category || flow.shopCategory, 256);
        if (shopCategory !== '') return shopCategory.split('>').map(function (item) { return text(item, 128); }).filter(function (item) { return item !== ''; });
        return arrayField(product.store_category_path_json);
    }
    function publishRequiredAttributes(value) {
        const objectValue = jsonField(value, {});
        const labels = [['mainFlower', '主花材'], ['color', '色系'], ['audience', '适用人群'], ['style', '款式'], ['quantity', '枝数/朵数']];
        const result = [], seen = {};
        for (let i = 0; i < labels.length; i++) {
            const key = labels[i][0], label = labels[i][1], attrValue = text(objectValue[key], 128);
            if ((attrValue !== '') && (seen[label] !== true)) { result.push({ label: label, value: attrValue }); seen[label] = true; }
        }
        return result;
    }
    function publishImagePaths(value) {
        const paths = arrayField(value), result = [];
        for (let i = 0; i < paths.length; i++) {
            const item = text(paths[i], 512);
            if (item === '') continue;
            result.push(((item.indexOf('/') >= 0) || (item.indexOf('\\') >= 0) || (/^[A-Za-z]:[\\/]/.test(item))) ? item.replace(/\\/g, '/') : ('runtime/images/' + item));
        }
        return result;
    }
    async function prepareFlow(flow) {
        const flowType = flow.flow_type || flow.flowType;
        const flowConfig = jsonField(flow.config, {});
        if (flowType === 'publish') {
            const cloned = cloneJson(flowConfig || {});
            const product = await dbPromise('GetProductByExactName', flow.product_name || flow.productName || '');
            let myShop = null;
            if (flow.my_shop_id || flow.myShopId) myShop = await dbPromise('GetMyShop', flow.my_shop_id || flow.myShopId);
            cloned.merchant = cloned.merchant || {};
            if (myShop != null) cloned.merchant.storeName = myShop.name || cloned.merchant.storeName || '';
            cloned.publishProduct = {
                name: text(flow.my_product_name || flow.myProductName || product.name, 512),
                entryUrl: text(product.entry_url, 2048) || null,
                categoryPath: normalizePublishCategoryPath(product.category_path_json),
                storeCategoryPath: publishStoreCategoryPath(flow, product),
                requiredAttributes: publishRequiredAttributes(product.required_attributes_json),
                requiredAttributeMappings: arrayField(cloned.requiredAttributeMappings || (cloned.publishProduct && cloned.publishProduct.requiredAttributeMappings)),
                useExistingOptionsOnly: product.use_existing_options_only !== false,
                price: Number(product.price || 0),
                originalPrice: product.original_price == null ? null : Number(product.original_price),
                inventory: Number(product.inventory || 0),
                description: product.description || '',
                sku: arrayField(product.sku_json),
                skuList: arrayField(product.sku_list_json),
                imagePaths: publishImagePaths(product.image_paths_json),
                imageUrls: arrayField(product.image_urls_json)
            };
            cloned._meshFlow = { flowType: 'publish', requestedAt: new Date().toISOString() };
            return { config: applyFlowContext(cloned, flow), bindings: null, background: false };
        }
        if (flowType === 'pricing') {
            const cloned = cloneJson(flowConfig || {});
            let resolvedResult = null;
            try {
                resolvedResult = await resolveCollectResult({ collectTaskId: cloned.collectTaskId, collectResultId: cloned.collectResultId }, 'collect_price', { maxAgeDays: 7, requireSyncSuccess: false, notFoundMessage: '调价流程缺少可用的价格采集结果。' });
            } catch (ex) {
                resolvedResult = await resolveCollectResult({ collectTaskId: cloned.collectTaskId, collectResultId: cloned.collectResultId }, 'collect_shop', { maxAgeDays: 7, requireSyncSuccess: false, notFoundMessage: '调价流程缺少可用的店铺采集价格结果。' });
            }
            cloned.referenceCollectResultId = resolvedResult.id;
            cloned.referenceCollectTaskId = resolvedResult.task_id;
            cloned.referenceCollectData = jsonField(resolvedResult.data, []);
            return { config: applyFlowContext(cloned, flow), bindings: [{ collectTaskId: resolvedResult.task_id, collectResultId: resolvedResult.id }], background: false };
        }
        if (flowType === 'auto_reply') {
            const cloned = normalizeAutoReplyConfig(flowConfig);
            cloned._meshFlow = { flowType: 'auto_reply', requestedAt: new Date().toISOString() };
            return { config: applyFlowContext(cloned, flow), bindings: null, background: true };
        }
        throw new Error('定时任务暂不支持该流程类型。');
    }
    async function enqueueCollectTask(taskId, context) {
        context = context || {};
        const task = await dbPromise('GetCollectTask', taskId);
        const resultId = makeId('collectresult');
        task.preparedResultId = resultId;
        const collectType = task.collect_type || task.collectType;
        const config = jsonField(task.config, {});
        config._meshCollect = { taskId: task.id, collectType: collectType, requestedAt: new Date().toISOString() };
        const scriptPath = normalizeCollectScriptPath(task, task.script_path || task.scriptPath);
        const runRow = await dbPromise('StartCollectRun', task, 'node_job_pending');
        const nodeJob = await dbPromise('CreateNodeJob', {
            jobType: collectType,
            targetNodeId: task.device_id || task.deviceId,
            idempotencyKey: context.idempotencyKey || ('collect:' + runRow.id),
            relatedType: context.relatedType || 'collect_result',
            relatedId: context.relatedId || runRow.id,
            payload: {
                kind: 'collect',
                collectType: collectType,
                taskName: task.name || '',
                taskTime: new Date().toISOString(),
                recordId: runRow.id,
                scriptPath: scriptPath,
                deviceOs: task.device_os || task.deviceOs,
                config: config,
                scheduledRunId: context.scheduledRunId || null,
                scheduledStepRunId: context.scheduledStepRunId || null
            }
        });
        return { status: 'queued', collectResultId: runRow.id, nodeJobId: nodeJob && nodeJob.id };
    }
    async function enqueueFlow(flowId, context) {
        context = context || {};
        const flow = await dbPromise('GetFlow', flowId);
        if ((flow.last_run_status || flow.lastRunStatus) === 'running' || flow.active_run_id || flow.running_run_id) throw new Error('流程正在执行中，请先停止后再执行。');
        const runId = makeId('flowrun');
        const prepared = await prepareFlow(flow);
        const flowType = flow.flow_type || flow.flowType;
        const scriptPath = normalizeFlowScriptPath(flow, flow.script_path || flow.scriptPath);
        const runRow = await dbPromise('StartFlowRun', flow, { id: runId, collectBindings: prepared.bindings, scriptPath: scriptPath, arguments: [], resultSummary: '节点任务等待领取。' });
        const nodeJob = await dbPromise('CreateNodeJob', {
            jobType: flowType === 'publish' ? 'publish_flow' : (flowType === 'pricing' ? 'pricing_flow' : flowType),
            targetNodeId: flow.device_id || flow.deviceId,
            idempotencyKey: context.idempotencyKey || ('flow:' + runRow.id),
            relatedType: context.relatedType || 'flow_run',
            relatedId: context.relatedId || runRow.id,
            payload: {
                kind: 'flow',
                flowType: flowType,
                taskName: flow.name || '',
                taskTime: new Date().toISOString(),
                recordId: runRow.id,
                scriptPath: scriptPath,
                deviceOs: flow.device_os || flow.deviceOs,
                config: prepared.config,
                collectBindings: prepared.bindings || null,
                background: prepared.background === true,
                scheduledRunId: context.scheduledRunId || null,
                scheduledStepRunId: context.scheduledStepRunId || null
            }
        });
        return { status: 'queued', flowRunId: runRow.id, nodeJobId: nodeJob && nodeJob.id, background: prepared.background === true };
    }
    async function enqueueFlowStop(flowId, runId, context) {
        context = context || {};
        const flow = await dbPromise('GetFlow', flowId);
        const run = await dbPromise('GetFlowRun', runId);
        const flowType = flow.flow_type || flow.flowType || run.flow_type || run.flowType || '';
        const processId = text(run.process_id || run.processId || '', 128);
        if (flowType !== 'auto_reply') throw new Error('当前流程不支持节点任务停止。');
        if (processId === '') throw new Error('当前客服流程缺少进程编号，无法远程停止。');
        const nodeJob = await dbPromise('CreateNodeJob', {
            jobType: 'flow_stop',
            targetNodeId: run.device_id || run.deviceId || flow.device_id || flow.deviceId,
            idempotencyKey: context.idempotencyKey || ('flow-stop:' + run.id),
            relatedType: 'flow_run',
            relatedId: run.id,
            payload: {
                kind: 'flow_stop',
                flowType: flowType,
                taskName: (flow.name || '') + ' 停止',
                taskTime: new Date().toISOString(),
                flowId: flow.id,
                runId: run.id,
                recordId: run.id,
                processId: processId,
                deviceOs: run.device_os || run.deviceOs || flow.device_os || flow.deviceOs
            }
        });
        return { status: 'queued', flowRunId: run.id, nodeJobId: nodeJob && nodeJob.id };
    }
    async function getStepTarget(step) {
        if (step.type === 'collect_task') { const task = await dbPromise('GetCollectTask', step.targetId); return { name: task.name || step.targetId }; }
        if (step.type === 'publish_flow' || step.type === 'pricing_flow') { const flow = await dbPromise('GetFlow', step.targetId); return { name: flow.name || step.targetId, flowType: flow.flow_type || flow.flowType }; }
        throw new Error('无效的步骤类型。');
    }
    async function enqueueScheduledStep(run, step, stepIndex) {
        const target = await getStepTarget(step);
        const stepRun = await dbPromise('StartScheduledTaskRunStep', run.id, stepIndex, step, target.name);
        const context = { scheduledRunId: run.id, scheduledStepRunId: stepRun.id, relatedType: 'scheduled_step', relatedId: stepRun.id, idempotencyKey: 'scheduled:' + stepRun.id };
        let result = null;
        if (step.type === 'collect_task') result = await enqueueCollectTask(step.targetId, context);
        else if (step.type === 'publish_flow' || step.type === 'pricing_flow') result = await enqueueFlow(step.targetId, context);
        else throw new Error('无效的步骤类型。');
        return { stepRun: stepRun, result: result };
    }
    async function finishScheduledRunIfDone(runId) {
        const run = await dbPromise('GetScheduledTaskRun', runId);
        const steps = await dbPromise('GetScheduledTaskRunSteps', runId);
        const taskSteps = arrayField(run.task_steps);
        if (steps.filter(function (item) { return item.status === 'running'; }).length > 0) return null;
        const successCount = steps.filter(function (item) { return item.status === 'success'; }).length;
        const failedCount = steps.filter(function (item) { return item.status === 'failed'; }).length;
        const skippedCount = steps.filter(function (item) { return item.status === 'skipped'; }).length + Math.max(0, taskSteps.length - steps.length);
        const finalStatus = failedCount === 0 ? 'success' : (successCount > 0 ? 'partial' : 'failed');
        const summary = '成功 ' + successCount + ' 步，失败 ' + failedCount + ' 步' + (skippedCount > 0 ? ('，跳过 ' + skippedCount + ' 步') : '') + '。';
        return await dbPromise('FinishScheduledTaskRun', run.id, run.scheduled_task_id, finalStatus, summary);
    }
    async function advanceScheduledStep(stepRunId, success, updates) {
        const stepRun = await dbPromise('GetScheduledTaskRunStep', stepRunId);
        const run = await dbPromise('GetScheduledTaskRun', stepRun.run_id);
        const taskSteps = arrayField(run.task_steps);
        const currentStep = taskSteps[stepRun.step_index] || {};
        await dbPromise('FinishScheduledTaskRunStep', stepRunId, updates || { status: success ? 'success' : 'failed' });
        const nextIndex = stepRun.step_index + 1;
        if (success === true || (currentStep.failurePolicy || 'stop') === 'continue') {
            if (nextIndex < taskSteps.length) {
                await enqueueScheduledStep(run, taskSteps[nextIndex], nextIndex);
                return null;
            }
        } else {
            for (let i = nextIndex; i < taskSteps.length; i++) {
                const skippedStep = await dbPromise('StartScheduledTaskRunStep', run.id, i, taskSteps[i], '');
                await dbPromise('FinishScheduledTaskRunStep', skippedStep.id, { status: 'skipped', error: '前序步骤失败，已按失败策略停止。' });
            }
        }
        return await finishScheduledRunIfDone(run.id);
    }
    async function executeScheduledTask(taskId, triggerType) {
        const clock = todayParts('Asia/Shanghai');
        if (obj.running[taskId]) throw new Error('定时任务正在执行中。');
        obj.running[taskId] = true;
        let task = null, run = null;
        try {
            task = await dbPromise('GetScheduledTask', taskId);
            const steps = arrayField(task.steps);
            run = await dbPromise('StartScheduledTaskRun', task, triggerType || 'manual', clock.date);
            if (steps.length === 0) return await dbPromise('FinishScheduledTaskRun', run.id, task.id, 'failed', '没有可派发的定时任务步骤。');
            const first = await enqueueScheduledStep(run, steps[0], 0);
            return { run: run, firstStep: first.stepRun, result: first.result };
        } catch (ex) {
            if (run && task) await dbPromise('FinishScheduledTaskRun', run.id, task.id, 'failed', ex.message || String(ex)).catch(function () { });
            throw ex;
        } finally {
            delete obj.running[taskId];
        }
    }
    obj.executeScheduledTask = executeScheduledTask;
    obj.enqueueCollectTask = enqueueCollectTask;
    obj.enqueueFlow = enqueueFlow;
    obj.enqueueFlowStop = enqueueFlowStop;
    obj.claimNodeJob = async function (nodeId, leaseSeconds) {
        const row = await dbPromise('ClaimNodeJob', nodeId, leaseSeconds || 600);
        if (row != null) {
            try {
                const payload = jsonField(row.payload, {});
                if (payload.kind === 'flow' && payload.recordId) {
                    await dbPromise('FinalizeFlowRun', payload.recordId, { status: 'running', resultSummary: '节点任务执行中。', stdout: '', stderr: '', resultJson: {}, lastHeartbeatAt: new Date() });
                }
            } catch (ex) {
                parent.parent.debug && parent.parent.debug('nodejobs', ex.message || String(ex));
            }
        }
        return row;
    };
    obj.heartbeatNodeJob = async function (jobId, nodeId, leaseToken, leaseSeconds, progress) {
        const row = await dbPromise('HeartbeatNodeJob', jobId, nodeId, leaseToken, leaseSeconds || 600, progress || '');
        if (row == null) throw new Error('任务租约无效或已过期。');
        try {
            const payload = jsonField(row.payload, {});
            if (payload.kind === 'flow' && payload.recordId) {
                await dbPromise('FinalizeFlowRun', payload.recordId, { status: 'running', resultSummary: '节点任务执行中。', stdout: '', stderr: '', resultJson: {}, lastHeartbeatAt: new Date() });
            }
        } catch (ex) {
            parent.parent.debug && parent.parent.debug('nodejobs', ex.message || String(ex));
        }
        return row;
    };
    obj.completeNodeJob = async function (jobId, nodeId, leaseToken, status, exitCode, stdout, stderr, resultJson) {
        const row = await dbPromise('CompleteNodeJob', jobId, nodeId, leaseToken, { status: status || 'success', exitCode: exitCode, stdout: stdout || '', stderr: stderr || '', resultJson: resultJson || {} });
        if (row == null) throw new Error('任务租约无效或已过期。');
        await finalizeNodeJob(row);
        return row;
    };
    async function finalizeNodeJob(row) {
        const payload = jsonField(row.payload, {});
        const resultJson = jsonField(row.result_json, {});
        const success = row.status === 'success';
        if (payload.kind === 'collect') {
            const data = Array.isArray(resultJson.data) ? resultJson.data : parseCollectData(row.stdout || '');
            const collectStatus = success ? ((data.length > 0 || String(row.stdout || '').trim() === '') ? 'success' : 'manual_required') : 'failed';
            await dbPromise('FinalizeCollectRun', payload.recordId, { status: collectStatus, exitCode: row.exit_code == null ? (success ? 0 : -1) : row.exit_code, stdout: row.stdout || '', stderr: row.stderr || '', data: data, resultMeta: resultJson.meta || {} });
            if (payload.scheduledStepRunId) await advanceScheduledStep(payload.scheduledStepRunId, collectStatus === 'success', { status: collectStatus === 'success' ? 'success' : 'failed', collectResultId: payload.recordId, error: collectStatus === 'success' ? null : summarizeOutput(row.stdout, row.stderr) });
        } else if (payload.kind === 'flow') {
            const flowStatus = success ? (payload.background && resultJson.processId ? 'running' : 'success') : 'failed';
            const summary = resultJson.summary || resultSummary(flowStatus, row.exit_code);
            await dbPromise('FinalizeFlowRun', payload.recordId, { status: flowStatus, exitCode: row.exit_code == null ? (success ? 0 : -1) : row.exit_code, stdout: row.stdout || '', stderr: row.stderr || '', resultSummary: summary, resultJson: resultJson, collectBindings: payload.collectBindings || null, processId: resultJson.processId || '' });
            if (payload.scheduledStepRunId) await advanceScheduledStep(payload.scheduledStepRunId, flowStatus === 'success' || flowStatus === 'running', { status: (flowStatus === 'success' || flowStatus === 'running') ? 'success' : 'failed', flowRunId: payload.recordId, error: (flowStatus === 'success' || flowStatus === 'running') ? null : summarizeOutput(row.stdout, row.stderr) });
        } else if (payload.kind === 'flow_stop') {
            const stopStatus = success ? 'stopped' : 'running';
            const summary = resultJson.summary || (success ? '常驻流程已停止。' : '停止失败，请重试。');
            await dbPromise('FinalizeFlowRun', payload.runId || payload.recordId, { status: stopStatus, exitCode: row.exit_code == null ? (success ? 0 : -1) : row.exit_code, stdout: row.stdout || '', stderr: row.stderr || '', resultSummary: summary, resultJson: resultJson, processId: success ? null : (payload.processId || ''), stopReason: success ? 'node-job-stop' : 'node-job-stop-failed' });
        }
    }
    obj.recoverExpiredNodeJobs = async function () {
        const result = await dbPromise('FailExpiredNodeJobs');
        const failed = result && Array.isArray(result.failed) ? result.failed : [];
        for (let i = 0; i < failed.length; i++) {
            try { await finalizeNodeJob(failed[i]); } catch (ex) { parent.parent.debug && parent.parent.debug('nodejobs', ex.message || String(ex)); }
        }
        return result;
    };
    obj.scanDueTasks = async function () {
        const clock = todayParts('Asia/Shanghai');
        let tasks = [];
        try { tasks = await dbPromise('GetDueScheduledTasks', clock.date, clock.time); } catch (ex) { return; }
        for (let i = 0; i < tasks.length; i++) {
            const triggerType = clock.time === tasks[i].schedule_time ? 'scheduled' : 'missed_makeup';
            executeScheduledTask(tasks[i].id, triggerType).catch(function (ex) { parent.parent.debug && parent.parent.debug('scheduledtask', ex.message || String(ex)); });
        }
    };
    obj.start = function () {
        if (obj.scanTimer != null) return;
        obj.scanTimer = setInterval(obj.scanDueTasks, 60 * 1000);
        obj.recoveryTimer = setInterval(function () { obj.recoverExpiredNodeJobs().catch(function () { }); }, 60 * 1000);
        setTimeout(obj.scanDueTasks, 15 * 1000);
        setTimeout(function () { obj.recoverExpiredNodeJobs().catch(function () { }); }, 20 * 1000);
    };
    obj.stop = function () {
        if (obj.scanTimer != null) clearInterval(obj.scanTimer);
        if (obj.recoveryTimer != null) clearInterval(obj.recoveryTimer);
        obj.scanTimer = null;
        obj.recoveryTimer = null;
    };
    return obj;
};
