-- Bootstrap schema for local MCPDatabase testing.
-- Safe to re-run: creates objects only when missing; procedures use CREATE OR ALTER.
-- Does not drop tables or delete data.
-- Batches are separated by GO for mssql (CREATE PROCEDURE must be first in its batch).

IF OBJECT_ID(N'dbo.Agents', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Agents (
    AgentId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    SeedKey NVARCHAR(64) NOT NULL,
    FullName NVARCHAR(200) NOT NULL,
    OfficeCode VARCHAR(20) NOT NULL,
    Email NVARCHAR(200) NULL,
    Phone VARCHAR(30) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_Agents_IsActive DEFAULT (1),
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Agents_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Agents_SeedKey UNIQUE (SeedKey)
  );
END;
GO

IF OBJECT_ID(N'dbo.Listings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Listings (
    ListingId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    MlsNumber VARCHAR(50) NOT NULL,
    ListingType VARCHAR(20) NOT NULL,
    PropType VARCHAR(100) NOT NULL,
    Beds INT NOT NULL,
    Baths DECIMAL(9, 2) NOT NULL,
    SqFt INT NOT NULL,
    Price DECIMAL(12, 2) NOT NULL,
    City NVARCHAR(100) NOT NULL,
    StateCode CHAR(2) NOT NULL,
    AddressLine NVARCHAR(200) NOT NULL,
    Description NVARCHAR(1000) NULL,
    AgentId INT NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_Listings_IsActive DEFAULT (1),
    ListedAt DATE NOT NULL,
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Listings_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Listings_MlsNumber UNIQUE (MlsNumber),
    CONSTRAINT CK_Listings_ListingType CHECK (ListingType IN (N'sale', N'rental')),
    CONSTRAINT CK_Listings_Beds CHECK (Beds >= 0 AND Beds <= 20),
    CONSTRAINT CK_Listings_Baths CHECK (Baths >= 0 AND Baths <= 20),
    CONSTRAINT CK_Listings_SqFt CHECK (SqFt >= 0),
    CONSTRAINT CK_Listings_Price CHECK (Price >= 0),
    CONSTRAINT FK_Listings_Agents FOREIGN KEY (AgentId) REFERENCES dbo.Agents (AgentId)
  );

  CREATE INDEX IX_Listings_ListingType ON dbo.Listings (ListingType);
  CREATE INDEX IX_Listings_City ON dbo.Listings (City);
  CREATE INDEX IX_Listings_PropType ON dbo.Listings (PropType);
  CREATE INDEX IX_Listings_Beds ON dbo.Listings (Beds);
  CREATE INDEX IX_Listings_SqFt ON dbo.Listings (SqFt);
  CREATE INDEX IX_Listings_Price ON dbo.Listings (Price);
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetLoveableAPIListings
  @listing_type VARCHAR(50),
  @mls VARCHAR(50) = NULL,
  @propTypes VARCHAR(100) = NULL,
  @minBed INT = NULL,
  @maxBed INT = NULL,
  @minBath DECIMAL(9, 2) = NULL,
  @maxBath DECIMAL(9, 2) = NULL,
  @minSqFt INT = NULL,
  @maxSqFt INT = NULL
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    l.ListingId,
    l.MlsNumber AS mls,
    l.ListingType AS listing_type,
    l.PropType AS propTypes,
    l.Beds AS beds,
    l.Baths AS baths,
    l.SqFt AS sqFt,
    l.Price AS price,
    l.City AS city,
    l.StateCode AS state,
    l.AddressLine AS address,
    l.Description AS description,
    a.FullName AS agentName,
    a.OfficeCode AS office_code,
    l.ListedAt AS listedAt
  FROM dbo.Listings AS l
  INNER JOIN dbo.Agents AS a ON a.AgentId = l.AgentId
  WHERE l.IsActive = 1
    AND l.ListingType = @listing_type
    AND (@mls IS NULL OR LTRIM(RTRIM(@mls)) = N'' OR l.MlsNumber = @mls)
    AND (
      @propTypes IS NULL
      OR LTRIM(RTRIM(@propTypes)) = N''
      OR EXISTS (
        -- Single value or comma-separated list (e.g. 'Condo' or 'Condo, Single Family').
        -- Values are compared as bound parameter tokens — not concatenated into dynamic SQL.
        SELECT 1
        FROM STRING_SPLIT(@propTypes, ',') AS parts
        WHERE LTRIM(RTRIM(parts.value)) <> N''
          AND l.PropType = LTRIM(RTRIM(parts.value))
      )
    )
    AND (@minBed IS NULL OR l.Beds >= @minBed)
    AND (@maxBed IS NULL OR l.Beds <= @maxBed)
    AND (@minBath IS NULL OR l.Baths >= @minBath)
    AND (@maxBath IS NULL OR l.Baths <= @maxBath)
    AND (@minSqFt IS NULL OR l.SqFt >= @minSqFt)
    AND (@maxSqFt IS NULL OR l.SqFt <= @maxSqFt)
  ORDER BY l.ListedAt DESC, l.ListingId DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetLoveableAPIAgentRoster
  @agent_id INT = NULL,
  @office_code VARCHAR(20) = NULL,
  @include_inactive BIT = 0,
  @search_name NVARCHAR(200) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    a.AgentId AS agent_id,
    a.FullName AS search_name,
    a.OfficeCode AS office_code,
    a.Email AS email,
    a.Phone AS phone,
    a.IsActive AS is_active,
    (
      SELECT COUNT(1)
      FROM dbo.Listings AS l
      WHERE l.AgentId = a.AgentId AND l.IsActive = 1
    ) AS active_listing_count
  FROM dbo.Agents AS a
  WHERE (@include_inactive = 1 OR a.IsActive = 1)
    AND (@agent_id IS NULL OR a.AgentId = @agent_id)
    AND (
      @office_code IS NULL
      OR LTRIM(RTRIM(@office_code)) = N''
      OR a.OfficeCode = @office_code
    )
    AND (
      @search_name IS NULL
      OR LTRIM(RTRIM(@search_name)) = N''
      OR a.FullName LIKE N'%' + @search_name + N'%'
    )
  ORDER BY a.FullName ASC, a.AgentId ASC;
END;
GO
