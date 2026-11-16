-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DIRECTOR', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "SessionState" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "QualityProfile" AS ENUM ('ECONOMY', 'STANDARD', 'BROADCAST', 'HIGH');

-- CreateEnum
CREATE TYPE "ParticipantState" AS ENUM ('INVITED', 'READY', 'CONNECTING', 'LIVE', 'DISCONNECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('CORRESPONDENT', 'GUEST', 'CONTRIBUTOR');

-- CreateEnum
CREATE TYPE "OnAirSource" AS ENUM ('MANUAL', 'VMIX');

-- CreateEnum
CREATE TYPE "EndpointKind" AS ENUM ('PUBLISH', 'VIEW', 'RETURN', 'DIRECTOR', 'NDI', 'SRT');

-- CreateEnum
CREATE TYPE "VmixMode" AS ENUM ('DIRECT', 'AGENT');

-- CreateEnum
CREATE TYPE "ConnectionEventType" AS ENUM ('JOIN_REQUESTED', 'CONNECTED', 'DISCONNECTED', 'RECONNECTED', 'MIC_CHANGED', 'CAMERA_CHANGED', 'ON_AIR_CHANGED', 'QUALITY_CHANGED', 'TALKBACK_OPENED', 'TALKBACK_CLOSED', 'MESSAGE_SENT', 'METRICS_ALERT', 'ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'DIRECTOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "tokenEpoch" INTEGER NOT NULL DEFAULT 0,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Production" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "defaultQualityProfile" "QualityProfile" NOT NULL DEFAULT 'BROADCAST',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Production_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "SessionState" NOT NULL DEFAULT 'SCHEDULED',
    "roomName" TEXT NOT NULL,
    "roomSecret" TEXT NOT NULL,
    "returnStreamId" TEXT NOT NULL,
    "tokenEpoch" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "ParticipantRole" NOT NULL DEFAULT 'CORRESPONDENT',
    "state" "ParticipantState" NOT NULL DEFAULT 'INVITED',
    "streamId" TEXT NOT NULL,
    "outputKey" TEXT NOT NULL,
    "qualityProfile" "QualityProfile" NOT NULL DEFAULT 'BROADCAST',
    "onAir" BOOLEAN NOT NULL DEFAULT false,
    "onAirSource" "OnAirSource" NOT NULL DEFAULT 'MANUAL',
    "micAllowed" BOOLEAN NOT NULL DEFAULT true,
    "cameraAllowed" BOOLEAN NOT NULL DEFAULT true,
    "returnBus" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastMetrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 5,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaEndpoint" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "kind" "EndpointKind" NOT NULL,
    "engineId" TEXT NOT NULL,
    "urlTemplate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VmixConnection" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 8088,
    "mode" "VmixMode" NOT NULL DEFAULT 'AGENT',
    "agentTokenHash" TEXT,
    "allowAddInput" BOOLEAN NOT NULL DEFAULT false,
    "allowProgramControl" BOOLEAN NOT NULL DEFAULT false,
    "returnBuses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastCheckedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "vmixVersion" TEXT,
    "vmixEdition" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmixConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VmixInputMapping" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "inputKey" TEXT NOT NULL,
    "inputNumber" INTEGER,
    "inputTitle" TEXT,
    "lastNavigatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmixInputMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT,
    "type" "ConnectionEventType" NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorKind" TEXT NOT NULL DEFAULT 'user',
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'ok',
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEnd" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Production_slug_key" ON "Production"("slug");

-- CreateIndex
CREATE INDEX "Production_ownerId_isArchived_idx" ON "Production"("ownerId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "Session_roomName_key" ON "Session"("roomName");

-- CreateIndex
CREATE UNIQUE INDEX "Session_returnStreamId_key" ON "Session"("returnStreamId");

-- CreateIndex
CREATE INDEX "Session_productionId_state_idx" ON "Session"("productionId", "state");

-- CreateIndex
CREATE INDEX "Session_state_purgeAfter_idx" ON "Session"("state", "purgeAfter");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_streamId_key" ON "Participant"("streamId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_outputKey_key" ON "Participant"("outputKey");

-- CreateIndex
CREATE INDEX "Participant_sessionId_state_idx" ON "Participant"("sessionId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_sessionId_idx" ON "Invitation"("sessionId");

-- CreateIndex
CREATE INDEX "Invitation_participantId_idx" ON "Invitation"("participantId");

-- CreateIndex
CREATE INDEX "Invitation_expiresAt_idx" ON "Invitation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaEndpoint_participantId_kind_key" ON "MediaEndpoint"("participantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "VmixConnection_host_port_key" ON "VmixConnection"("host", "port");

-- CreateIndex
CREATE INDEX "VmixInputMapping_sessionId_idx" ON "VmixInputMapping"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "VmixInputMapping_connectionId_inputKey_key" ON "VmixInputMapping"("connectionId", "inputKey");

-- CreateIndex
CREATE UNIQUE INDEX "VmixInputMapping_participantId_connectionId_key" ON "VmixInputMapping"("participantId", "connectionId");

-- CreateIndex
CREATE INDEX "ConnectionEvent_sessionId_createdAt_idx" ON "ConnectionEvent"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ConnectionEvent_participantId_createdAt_idx" ON "ConnectionEvent"("participantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimit_windowEnd_idx" ON "RateLimit"("windowEnd");

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaEndpoint" ADD CONSTRAINT "MediaEndpoint_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmixConnection" ADD CONSTRAINT "VmixConnection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmixInputMapping" ADD CONSTRAINT "VmixInputMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "VmixConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmixInputMapping" ADD CONSTRAINT "VmixInputMapping_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmixInputMapping" ADD CONSTRAINT "VmixInputMapping_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionEvent" ADD CONSTRAINT "ConnectionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionEvent" ADD CONSTRAINT "ConnectionEvent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
