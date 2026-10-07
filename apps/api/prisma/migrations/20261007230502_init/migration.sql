-- CreateTable
CREATE TABLE `health_check` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `note` VARCHAR(191) NOT NULL,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `node` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(16) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `no` VARCHAR(32) NULL,
    `stage` VARCHAR(16) NULL,
    `source` VARCHAR(512) NULL,
    `field` VARCHAR(64) NULL,
    `cn` VARCHAR(16) NULL,
    `unit` BOOLEAN NULL,
    `pending` TEXT NULL,
    `tone` VARCHAR(16) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `parentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `node_parentId_order_idx`(`parentId`, `order`),
    INDEX `node_kind_idx`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nodeId` INTEGER NOT NULL,
    `html` LONGTEXT NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `content_nodeId_version_key`(`nodeId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `card_type` (
    `name` VARCHAR(16) NOT NULL,
    `defaultWeight` DOUBLE NOT NULL DEFAULT 1,
    `order` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `card` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nodeId` INTEGER NOT NULL,
    `no` INTEGER NOT NULL,
    `weight` DOUBLE NOT NULL DEFAULT 1,
    `typeName` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `card_typeName_idx`(`typeName`),
    UNIQUE INDEX `card_nodeId_no_key`(`nodeId`, `no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `role_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(64) NOT NULL,

    UNIQUE INDEX `permission_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permission` (
    `roleId` INTEGER NOT NULL,
    `permissionId` INTEGER NOT NULL,

    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `nickname` VARCHAR(64) NOT NULL,
    `grade` VARCHAR(64) NULL,
    `stage` VARCHAR(16) NULL,
    `classId` INTEGER NULL,
    `roleId` INTEGER NOT NULL,
    `disabledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_username_key`(`username`),
    INDEX `user_roleId_idx`(`roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `token` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `password_reset_token_key`(`token`),
    INDEX `password_reset_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `session` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `class` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(64) NOT NULL,
    `stage` VARCHAR(16) NOT NULL,
    `grade` VARCHAR(64) NULL,
    `teacherId` INTEGER NULL,
    `note` VARCHAR(5000) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `class_stage_order_idx`(`stage`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_change` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `batchId` VARCHAR(32) NOT NULL,
    `actorId` INTEGER NOT NULL,
    `targetId` INTEGER NOT NULL,
    `entity` VARCHAR(32) NOT NULL,
    `entityId` VARCHAR(32) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `field` VARCHAR(48) NOT NULL,
    `oldValue` TEXT NULL,
    `newValue` TEXT NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `data_change_targetId_createdAt_idx`(`targetId`, `createdAt`),
    INDEX `data_change_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `data_change_batchId_idx`(`batchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `learning_record` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `nodeId` INTEGER NOT NULL,
    `mastery` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL,
    `learnedAt` VARCHAR(16) NULL,
    `reviewAt` VARCHAR(16) NULL,
    `plannedAt` VARCHAR(16) NULL,
    `diff` DOUBLE NULL,
    `term` VARCHAR(16) NULL,
    `factors` TEXT NULL,
    `cards` TEXT NULL,
    `blocked` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `learning_record_userId_status_idx`(`userId`, `status`),
    UNIQUE INDEX `learning_record_userId_nodeId_key`(`userId`, `nodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `learning_event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recordId` INTEGER NOT NULL,
    `at` BIGINT NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `mastery` INTEGER NOT NULL DEFAULT 0,
    `examCode` VARCHAR(16) NULL,
    `score` INTEGER NULL,
    `full` INTEGER NULL,
    `fromVal` INTEGER NULL,
    `toVal` INTEGER NULL,

    INDEX `learning_event_recordId_idx`(`recordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `code` VARCHAR(16) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `at` BIGINT NOT NULL,
    `date` VARCHAR(16) NOT NULL,
    `fromIdx` INTEGER NOT NULL,
    `toIdx` INTEGER NOT NULL,
    `scope` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `exam_userId_idx`(`userId`),
    UNIQUE INDEX `exam_userId_code_key`(`userId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_paper` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `examId` INTEGER NOT NULL,
    `index` INTEGER NOT NULL,
    `nodeId` INTEGER NULL,
    `full` INTEGER NOT NULL,
    `score` INTEGER NOT NULL,
    `card` INTEGER NOT NULL,
    `also` TEXT NULL,
    `causes` TEXT NULL,

    INDEX `exam_paper_examId_idx`(`examId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mistake` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'exam',
    `nodeId` INTEGER NULL,
    `nodeName` VARCHAR(191) NOT NULL DEFAULT '',
    `examCode` VARCHAR(16) NULL,
    `cellIndex` INTEGER NULL,
    `cardNo` INTEGER NULL,
    `causes` TEXT NULL,
    `questionId` INTEGER NULL,
    `given` VARCHAR(191) NULL,
    `score` INTEGER NULL,
    `full` INTEGER NULL,
    `at` BIGINT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mistake_userId_status_idx`(`userId`, `status`),
    INDEX `mistake_userId_source_idx`(`userId`, `source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `favorite` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `refId` VARCHAR(64) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `sub` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `favorite_userId_idx`(`userId`),
    UNIQUE INDEX `favorite_userId_kind_refId_key`(`userId`, `kind`, `refId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `note` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `nodeId` INTEGER NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `note_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `point_mark` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recordId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `nodeId` INTEGER NOT NULL,
    `mark` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `point_mark_userId_mark_idx`(`userId`, `mark`),
    UNIQUE INDEX `point_mark_userId_nodeId_mark_key`(`userId`, `nodeId`, `mark`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `learning_profile` (
    `userId` INTEGER NOT NULL,
    `todayAt` VARCHAR(16) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(16) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `tag` VARCHAR(191) NULL,
    `stem` TEXT NOT NULL,
    `options` TEXT NULL,
    `blanks` TEXT NULL,
    `answer` VARCHAR(64) NULL,
    `explanation` TEXT NULL,
    `source` VARCHAR(64) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `question_code_key`(`code`),
    INDEX `question_kind_idx`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `practice_session` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `total` INTEGER NOT NULL DEFAULT 0,
    `correct` INTEGER NULL,
    `judged` INTEGER NULL,
    `submittedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `practice_session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `practice_answer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` INTEGER NOT NULL,
    `questionId` INTEGER NOT NULL,
    `given` VARCHAR(191) NULL,
    `correct` BOOLEAN NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    INDEX `practice_answer_sessionId_idx`(`sessionId`),
    UNIQUE INDEX `practice_answer_sessionId_questionId_key`(`sessionId`, `questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `board` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `desc` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `board_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `post` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `boardId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `authorId` INTEGER NULL,
    `authorName` VARCHAR(64) NOT NULL,
    `views` INTEGER NOT NULL DEFAULT 0,
    `seedKey` VARCHAR(64) NULL,
    `pinnedAt` DATETIME(3) NULL,
    `goodAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `post_seedKey_key`(`seedKey`),
    INDEX `post_boardId_idx`(`boardId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reply` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `postId` INTEGER NOT NULL,
    `authorId` INTEGER NULL,
    `authorName` VARCHAR(64) NOT NULL,
    `role` VARCHAR(32) NULL,
    `text` TEXT NOT NULL,
    `seedKey` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `reply_seedKey_key`(`seedKey`),
    INDEX `reply_postId_idx`(`postId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `priceCents` INTEGER NOT NULL DEFAULT 0,
    `originalCents` INTEGER NOT NULL DEFAULT 0,
    `days` INTEGER NOT NULL DEFAULT 0,
    `tagline` VARCHAR(191) NULL,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `plan_code_key`(`code`),
    INDEX `plan_active_order_idx`(`active`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `desc` VARCHAR(191) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_item_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_service` (
    `planId` INTEGER NOT NULL,
    `serviceId` INTEGER NOT NULL,
    `included` BOOLEAN NOT NULL DEFAULT true,
    `value` VARCHAR(64) NULL,
    `quota` INTEGER NULL,

    PRIMARY KEY (`planId`, `serviceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `planId` INTEGER NOT NULL,
    `startAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endAt` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `orderNo` VARCHAR(32) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `subscription_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderNo` VARCHAR(32) NOT NULL,
    `userId` INTEGER NOT NULL,
    `planCode` VARCHAR(32) NOT NULL,
    `planName` VARCHAR(64) NOT NULL,
    `days` INTEGER NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `channel` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `paidAt` DATETIME(3) NULL,

    UNIQUE INDEX `order_orderNo_key`(`orderNo`),
    INDEX `order_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_slice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `date` VARCHAR(16) NOT NULL,
    `subject` VARCHAR(64) NOT NULL,
    `paperType` VARCHAR(32) NOT NULL,
    `score` INTEGER NULL,
    `full` INTEGER NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `exam_slice_userId_date_idx`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_slice_image` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sliceId` INTEGER NOT NULL,
    `file` VARCHAR(191) NOT NULL,
    `label` VARCHAR(32) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `bytes` INTEGER NOT NULL DEFAULT 0,

    INDEX `exam_slice_image_sliceId_idx`(`sliceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_slice_box` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sliceId` INTEGER NOT NULL,
    `page` INTEGER NOT NULL,
    `q` INTEGER NOT NULL,
    `x` DOUBLE NOT NULL,
    `y` DOUBLE NOT NULL,
    `w` DOUBLE NOT NULL,
    `h` DOUBLE NOT NULL,
    `nodeId` INTEGER NULL,
    `cause` VARCHAR(191) NULL,

    INDEX `exam_slice_box_sliceId_idx`(`sliceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_slice_node` (
    `sliceId` INTEGER NOT NULL,
    `nodeId` INTEGER NOT NULL,

    PRIMARY KEY (`sliceId`, `nodeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_question` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(16) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `stem` LONGTEXT NOT NULL,
    `options` TEXT NULL,
    `blanks` TEXT NULL,
    `answer` VARCHAR(64) NULL,
    `explanation` LONGTEXT NULL,
    `year` INTEGER NOT NULL,
    `region` VARCHAR(64) NOT NULL,
    `paperType` VARCHAR(32) NOT NULL,
    `qtype` VARCHAR(32) NOT NULL,
    `difficulty` INTEGER NOT NULL DEFAULT 3,
    `no` VARCHAR(16) NULL,
    `nodeId` INTEGER NULL,
    `source` VARCHAR(191) NULL,
    `creatorId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `exam_question_code_key`(`code`),
    INDEX `exam_question_year_idx`(`year`),
    INDEX `exam_question_region_idx`(`region`),
    INDEX `exam_question_paperType_idx`(`paperType`),
    INDEX `exam_question_qtype_idx`(`qtype`),
    INDEX `exam_question_nodeId_idx`(`nodeId`),
    INDEX `exam_question_difficulty_idx`(`difficulty`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `channel` VARCHAR(16) NOT NULL,
    `transactionId` VARCHAR(64) NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `raw` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_transactionId_key`(`transactionId`),
    INDEX `payment_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `node` ADD CONSTRAINT `node_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `node`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content` ADD CONSTRAINT `content_nodeId_fkey` FOREIGN KEY (`nodeId`) REFERENCES `node`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `card` ADD CONSTRAINT `card_nodeId_fkey` FOREIGN KEY (`nodeId`) REFERENCES `node`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `card` ADD CONSTRAINT `card_typeName_fkey` FOREIGN KEY (`typeName`) REFERENCES `card_type`(`name`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permission` ADD CONSTRAINT `role_permission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permission` ADD CONSTRAINT `role_permission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `class`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset` ADD CONSTRAINT `password_reset_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `session` ADD CONSTRAINT `session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class` ADD CONSTRAINT `class_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_change` ADD CONSTRAINT `data_change_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_change` ADD CONSTRAINT `data_change_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_record` ADD CONSTRAINT `learning_record_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_record` ADD CONSTRAINT `learning_record_nodeId_fkey` FOREIGN KEY (`nodeId`) REFERENCES `node`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_event` ADD CONSTRAINT `learning_event_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `learning_record`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam` ADD CONSTRAINT `exam_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_paper` ADD CONSTRAINT `exam_paper_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exam`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mistake` ADD CONSTRAINT `mistake_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `favorite` ADD CONSTRAINT `favorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `note` ADD CONSTRAINT `note_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `note` ADD CONSTRAINT `note_nodeId_fkey` FOREIGN KEY (`nodeId`) REFERENCES `node`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `point_mark` ADD CONSTRAINT `point_mark_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `learning_record`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `point_mark` ADD CONSTRAINT `point_mark_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `point_mark` ADD CONSTRAINT `point_mark_nodeId_fkey` FOREIGN KEY (`nodeId`) REFERENCES `node`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_profile` ADD CONSTRAINT `learning_profile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_session` ADD CONSTRAINT `practice_session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_answer` ADD CONSTRAINT `practice_answer_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `practice_session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_answer` ADD CONSTRAINT `practice_answer_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `question`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post` ADD CONSTRAINT `post_boardId_fkey` FOREIGN KEY (`boardId`) REFERENCES `board`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post` ADD CONSTRAINT `post_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reply` ADD CONSTRAINT `reply_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reply` ADD CONSTRAINT `reply_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_service` ADD CONSTRAINT `plan_service_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `plan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_service` ADD CONSTRAINT `plan_service_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `service_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription` ADD CONSTRAINT `subscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription` ADD CONSTRAINT `subscription_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order` ADD CONSTRAINT `order_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_slice` ADD CONSTRAINT `exam_slice_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_slice_image` ADD CONSTRAINT `exam_slice_image_sliceId_fkey` FOREIGN KEY (`sliceId`) REFERENCES `exam_slice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_slice_box` ADD CONSTRAINT `exam_slice_box_sliceId_fkey` FOREIGN KEY (`sliceId`) REFERENCES `exam_slice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_slice_node` ADD CONSTRAINT `exam_slice_node_sliceId_fkey` FOREIGN KEY (`sliceId`) REFERENCES `exam_slice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_slice_node` ADD CONSTRAINT `exam_slice_node_nodeId_fkey` FOREIGN KEY (`nodeId`) REFERENCES `node`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_question` ADD CONSTRAINT `exam_question_nodeId_fkey` FOREIGN KEY (`nodeId`) REFERENCES `node`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_question` ADD CONSTRAINT `exam_question_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment` ADD CONSTRAINT `payment_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

