import React, { useState, useEffect } from 'react';
import { 
  Layout, 
  Typography, 
  Upload, 
  Button, 
  Card, 
  Input, 
  Select, 
  AutoComplete,
  Space, 
  List, 
  message, 
  Form,
  Row,
  Col
} from 'antd';
import { 
  UploadOutlined, 
  DownloadOutlined, 
  DeleteOutlined, 
  FileAddOutlined,
  PlusOutlined
} from '@ant-design/icons';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { v4 as uuidv4 } from 'uuid';

const { Header, Content, Footer } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

interface SkinEntry {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  geometryId: string;
  capeFile?: File;
  capePreviewUrl?: string;
  animations?: Record<string, string>;
}

interface GeometryEntry {
  id: string;
  name: string; // The key in geometry.json, e.g., "geometry.humanoid.custom"
  data: any; // The bones and other data for this geometry
}

const App: React.FC = () => {
  const [skins, setSkins] = useState<SkinEntry[]>([]);
  const [geometries, setGeometries] = useState<GeometryEntry[]>([]);
  const [packName, setPackName] = useState('My Skin Pack');
  const [authorName, setAuthorName] = useState('Developer');
  const [newAnimationKeys, setNewAnimationKeys] = useState<Record<string, string>>({});
  const [newAnimationIds, setNewAnimationIds] = useState<Record<string, string>>({});

  const handleSkinUpload = (info: any) => {
    const file = info.file;
    const reader = new FileReader();
    reader.onload = (e) => {
      const newSkin: SkinEntry = {
        id: uuidv4(),
        file: file,
        previewUrl: e.target?.result as string,
        name: file.name.replace('.png', ''),
        geometryId: 'geometry.humanoid.customSlim', // Default
      };
      setSkins(prev => [...prev, newSkin]);
    };
    reader.readAsDataURL(file);
    return false; // Prevent auto upload
  };

  const handleGeometryUpload = (info: any) => {
    const file = info.file;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        const newGeometries: GeometryEntry[] = [];
        
        // Minecraft geometry files can have multiple geometry entries
        Object.keys(json).forEach(key => {
          if (key.startsWith('geometry.')) {
            newGeometries.push({
              id: key,
              name: key,
              data: json[key]
            });
          }
        });

        if (newGeometries.length === 0) {
          message.error('No valid geometry definitions found in file.');
          return;
        }

        // Avoid duplicates
        setGeometries(prev => {
          const existingIds = new Set(prev.map(g => g.id));
          const uniqueNew = newGeometries.filter(g => !existingIds.has(g.id));
          return [...prev, ...uniqueNew];
        });
        message.success(`Added ${newGeometries.length} geometry definitions.`);
      } catch (err) {
        message.error('Failed to parse geometry.json');
      }
    };
    reader.readAsText(file);
    return false;
  };

  const handleCapeUpload = (skinId: string, info: any) => {
    const file = info.file;
    const reader = new FileReader();
    reader.onload = (e) => {
      updateSkin(skinId, {
        capeFile: file,
        capePreviewUrl: e.target?.result as string
      });
    };
    reader.readAsDataURL(file);
    return false; // Prevent auto upload
  };

  const removeCape = (skinId: string) => {
    updateSkin(skinId, {
      capeFile: undefined,
      capePreviewUrl: undefined
    });
  };
  
  const addAnimation = (skinId: string, key: string, identifier: string) => {
    setSkins(prev => prev.map(s => {
      if (s.id === skinId) {
        return {
          ...s,
          animations: {
            ...(s.animations || {}),
            [key]: identifier
          }
        };
      }
      return s;
    }));
  };

  const removeAnimation = (skinId: string, key: string) => {
    setSkins(prev => prev.map(s => {
      if (s.id === skinId) {
        const newAnimations = { ...(s.animations || {}) };
        delete newAnimations[key];
        return {
          ...s,
          animations: newAnimations
        };
      }
      return s;
    }));
  };

  const removeSkin = (id: string) => {
    setSkins(prev => prev.filter(s => s.id !== id));
  };

  const updateSkin = (id: string, updates: Partial<SkinEntry>) => {
    setSkins(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const generatePack = async () => {
    if (skins.length === 0) {
      message.error('Please upload at least one skin.');
      return;
    }

    const zip = new JSZip();
    const packId = packName.replace(/\s+/g, '_').toLowerCase();

    // 1. manifest.json
    const manifest = {
      format_version: 2,
      header: {
        name: packName,
        uuid: uuidv4(),
        version: [1, 0, 0]
      },
      modules: [
        {
          type: "skin_pack",
          uuid: uuidv4(),
          version: [1, 0, 0]
        }
      ]
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 4));

    // 2. Compute unique names for skins
    const usedNames = new Set<string>();
    const uniqueSkins = skins.map((skin) => {
      let uniqueName = skin.name;
      let counter = 1;
      while (usedNames.has(uniqueName)) {
        uniqueName = `${skin.name}_${counter}`;
        counter++;
      }
      usedNames.add(uniqueName);
      return { ...skin, uniqueName };
    });

    // 3. skins.json
    const skinsJson = {
      skins: uniqueSkins.map(skin => ({
        localization_name: skin.uniqueName,
        geometry: skin.geometryId,
        texture: skin.file.name,
        cape: skin.capeFile ? skin.capeFile.name : undefined,
        animations: skin.animations && Object.keys(skin.animations).length > 0 ? skin.animations : undefined,
        type: "free"
      })),
      serialize_name: packId,
      localization_name: packId
    };
    zip.file('skins.json', JSON.stringify(skinsJson, null, 4));

    // 4. geometry/geometry.json
    const mergedGeometry: any = {
      format_version: "1.8.0"
    };
    
    // Only include geometries that are actually selected by at least one skin
    const usedGeometryIds = new Set(skins.map(s => s.geometryId));
    const usedGeometries = geometries.filter(g => usedGeometryIds.has(g.id));

    usedGeometries.forEach(g => {
      // For default geometries, we might not have 'data'. 
      // Minecraft usually has these built-in, but if we want to include them in the file:
      if (Object.keys(g.data).length > 0) {
        mergedGeometry[g.name] = g.data;
      }
    });

    if (Object.keys(mergedGeometry).length > 1) { // More than just format_version
      zip.file('geometry.json', JSON.stringify(mergedGeometry, null, 4));
    }

    // 5. texts/en_US.lang
    let langContent = `skinpack.${packId}=${packName}\n`;
    langContent += `skinpack.${packId}.by=${authorName}\n`;
    uniqueSkins.forEach(skin => {
      langContent += `skin.${packId}.${skin.uniqueName}=${skin.uniqueName}\n`;
    });
    zip.folder('texts')?.file('en_US.lang', langContent);

    // 5. PNG Files
    skins.forEach(skin => {
      zip.file(skin.file.name, skin.file);
      if (skin.capeFile) {
        zip.file(skin.capeFile.name, skin.capeFile);
      }
    });

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${packId}.zip`);
    message.success('Skin pack generated!');
  };

  // Add default geometries
  useEffect(() => {
    setGeometries([
      { id: 'geometry.humanoid.custom', name: 'geometry.humanoid.custom', data: {} },
      { id: 'geometry.humanoid.customSlim', name: 'geometry.humanoid.customSlim', data: {} }
    ]);
  }, []);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center' }}>
        <Title level={3} style={{ margin: 0 }}>McSkinner</Title>
      </Header>
      <Content style={{ padding: '24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <Card title="Pack Settings" style={{ marginBottom: 24 }}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Pack Name" layout="vertical" style={{ margin: 0 }}>
                  <Input value={packName} onChange={e => setPackName(e.target.value)} />
                </Form.Item>
                <Form.Item label="Author" layout="vertical" style={{ margin: 0, marginTop: 12 }}>
                  <Input value={authorName} onChange={e => setAuthorName(e.target.value)} />
                </Form.Item>
              </Col>
              <Col span={12} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  type="primary"
                  size="large"
                  icon={<DownloadOutlined />}
                  block
                  style={{ height: 60, width: 'auto' }}
                  onClick={generatePack}
                >
                  Save Skin Pack (.zip)
                </Button>
              </Col>
            </Row>
          </Card>

          <Row gutter={24}>
            <Col span={16}>
              <Card
                title="Skins"
                extra={
                  <Upload
                    accept=".png"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      handleSkinUpload({ file });
                      return false;
                    }}
                  >
                    <Button icon={<UploadOutlined />}>Open PNG</Button>
                  </Upload>
                }
              >
                {skins.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                    <FileAddOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                    <p>No skins uploaded yet. Upload some PNGs to get started.</p>
                  </div>
                ) : (
                  <List
                    grid={{ gutter: 16, column: 1 }}
                    dataSource={skins}
                    renderItem={skin => (
                      <List.Item>
                        <Card
                          cover={
                            <div style={{ position: 'relative', height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f0f0', overflow: 'hidden' }}>
                              <img
                                src={skin.previewUrl}
                                alt={skin.name}
                                style={{ maxHeight: '100%', maxWidth: '100%', imageRendering: 'pixelated' }}
                              />
                              {skin.capePreviewUrl && (
                                <div style={{ 
                                  position: 'absolute', 
                                  bottom: 8, 
                                  right: 8, 
                                  width: 40, 
                                  height: 60, 
                                  border: '1px solid #ddd', 
                                  background: '#fff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center'
                                }}>
                                  <img
                                    src={skin.capePreviewUrl}
                                    alt="Cape"
                                    style={{ maxHeight: '100%', maxWidth: '100%', imageRendering: 'pixelated' }}
                                  />
                                </div>
                              )}
                            </div>
                          }
                          actions={[
                            <DeleteOutlined key="delete" onClick={() => removeSkin(skin.id)} />
                          ]}
                        >
                          <Space direction="vertical" style={{ width: '100%' }}>
                            <Input
                              addonBefore="Name"
                              value={skin.name}
                              onChange={e => updateSkin(skin.id, { name: e.target.value })}
                            />
                            <Select
                              showSearch
                              style={{ width: '100%' }}
                              value={skin.geometryId}
                              onChange={val => updateSkin(skin.id, { geometryId: val })}
                              placeholder="Select Geometry"
                              optionFilterProp="children"
                              filterOption={(input, option) =>
                                (option?.children as unknown as string).toLowerCase().includes(input.toLowerCase())
                              }
                            >
                              {geometries.map(g => (
                                <Option key={g.id} value={g.id}>{g.name}</Option>
                              ))}
                            </Select>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <Upload
                                accept=".png"
                                showUploadList={false}
                                beforeUpload={(file) => {
                                  handleCapeUpload(skin.id, { file });
                                  return false;
                                }}
                              >
                                <Button size="small" icon={<UploadOutlined />}>
                                  {skin.capeFile ? 'Change Cape' : 'Add Cape'}
                                </Button>
                              </Upload>
                              {skin.capeFile && (
                                <Button 
                                  size="small" 
                                  danger 
                                  icon={<DeleteOutlined />} 
                                  onClick={() => removeCape(skin.id)}
                                />
                              )}
                            </div>
                            
                            <div style={{ marginTop: 8 }}>
                              <Text strong>Animations</Text>
                              <div style={{ display: 'flex' }}>
                                <div style={{ width: '40%', paddingRight: 8, flexShrink: 0 }}>
                                  <AutoComplete
                                    size="small"
                                    placeholder="Key"
                                    style={{ width: '100%' }}
                                    value={newAnimationKeys[skin.id]}
                                    onChange={(val) => setNewAnimationKeys(prev => ({ ...prev, [skin.id]: val }))}
                                    options={[
                                      { value: 'move.arms' },
                                      { value: 'move.legs' },
                                    ]}
                                  />
                                </div>
                                <div style={{ width: '60%', flexShrink: 0, display: 'flex' }}>
                                  <AutoComplete
                                    size="small"
                                    style={{ flexGrow: 1, marginRight: 8 }}
                                    placeholder="ID"
                                    value={newAnimationIds[skin.id] || ''}
                                    onChange={(val) => setNewAnimationIds(prev => ({ ...prev, [skin.id]: val }))}
                                    options={[
                                      { value: 'animation.player.move.legs.stationary' },
                                      { value: 'animation.player.move.arms.stationary' },
                                      { value: 'animation.player.move.legs.single' },
                                      { value: 'animation.player.move.arms.single' },
                                      { value: 'animation.player.move.arms.statue_of_liberty' },
                                      { value: 'animation.player.move.arms.zombie' },
                                    ]}
                                  />
                                  <Button
                                    size="small"
                                    icon={<PlusOutlined />}
                                    onClick={() => {
                                      const key = newAnimationKeys[skin.id];
                                      const id = newAnimationIds[skin.id];
                                      if (key && id) {
                                        addAnimation(skin.id, key, id);
                                        setNewAnimationIds(prev => ({ ...prev, [skin.id]: '' }));
                                      } else {
                                        message.warning('Please select a key and enter an ID');
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                              <List
                                size="small"
                                dataSource={Object.entries(skin.animations || {})}
                                locale={{ emptyText: <></> }}
                                renderItem={([key, val]) => (
                                  <List.Item
                                    actions={[
                                      <Button
                                        type="text"
                                        size="small"
                                        danger
                                        icon={<DeleteOutlined />}
                                        onClick={() => removeAnimation(skin.id, key)}
                                      />
                                    ]}
                                    style={{ padding: '4px 0' }}
                                  >
                                    <Text type="secondary" style={{ fontSize: '12px' }}>{key}: {val}</Text>
                                  </List.Item>
                                )}
                              />
                            </div>
                          </Space>
                        </Card>
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>

            <Col span={8}>
              <Card
                title="Geometries"
                extra={
                  <Upload
                    accept=".json"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      handleGeometryUpload({ file });
                      return false;
                    }}
                  >
                    <Button icon={<UploadOutlined />}>Open JSON</Button>
                  </Upload>
                }
              >
                <List
                  size="small"
                  dataSource={geometries}
                  renderItem={item => (
                    <List.Item>
                      <Text ellipsis style={{ width: '100%' }}>{item.name}</Text>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          </Row>
        </div>
      </Content>
      <Footer style={{ textAlign: 'center' }}>
        Minecraft Skin Pack Generator ©2026
      </Footer>
    </Layout>
  );
};

export default App;
